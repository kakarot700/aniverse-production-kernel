/**
 * Mirror racing + failover worker.
 *
 * Runs off the main thread so a slow or dead server never blocks the UI.
 *
 * Strategy: **hedged parallel racing**, not sequential walking. The previous
 * revision probed one mirror at a time and waited up to 7 s before moving on,
 * so a list of twelve mirrors could take well over a minute to give up. Here
 * the first candidate is launched immediately and, if it has not answered
 * within `HEDGE_DELAY_MS`, the next one is launched *alongside* it — up to
 * `MAX_PARALLEL_PROBES` in flight. The first mirror to return a healthy
 * response wins and every other attempt is aborted. Worst-case time to a
 * playable stream becomes roughly one probe timeout instead of N of them.
 *
 * Attempt order is not the raw registry order: `lib/streams/health.ts` keeps a
 * session memory of what has actually been working and reorders accordingly,
 * with a circuit breaker so a mirror that just failed is not retried first.
 *
 * Every command bumps a session token, so late responses from an abandoned
 * attempt are discarded instead of racing the current one.
 */
import {
  createHealthBook,
  orderMirrorIndices,
  pruneHealthBook,
  recordFailure,
  recordSuccess,
  type MirrorHealthBook,
} from '../lib/streams/health';

export interface WorkerMirror {
  id: string;
  name: string;
  /** Final URL the player should load (already proxied when required). */
  url: string;
  /** Same-origin proxy URLs can be verified before we hand them to hls.js. */
  probe: boolean;
  /** Registry ranking; lower is tried first before health adjustments. */
  priority?: number;
}

export type WorkerRequest =
  | {
      type: 'INITIALIZE_STREAM';
      payload: {
        requestId: string;
        mirrors: WorkerMirror[];
        /** Mirror id to try first, e.g. the viewer's last working server. */
        preferredId?: string | null;
      };
    }
  | { type: 'TRY_NEXT_MIRROR'; payload: { requestId: string; fromIndex: number } }
  | { type: 'SELECT_MIRROR'; payload: { requestId: string; index: number } }
  | { type: 'CANCEL_STREAM'; payload: { requestId: string } };

export type WorkerResponse =
  | {
      type: 'STREAM_CONNECTED';
      payload: {
        requestId: string;
        url: string;
        latencyMs: number;
        index: number;
        id: string;
        name: string;
        probed: boolean;
        /** How many mirrors were raced before this one answered. */
        attempts: number;
      };
    }
  | {
      type: 'MIRROR_PROBE';
      payload: { requestId: string; index: number; id: string; ok: boolean; latencyMs: number };
    }
  | { type: 'FAILOVER_TRIGGERED'; payload: { requestId: string; index: number; id: string; name: string } }
  | { type: 'RACE_PROGRESS'; payload: { requestId: string; inFlight: number; remaining: number } }
  | { type: 'STREAM_CRITICAL_FAILURE'; payload: { requestId: string; message: string } };

/**
 * Tight on purpose. Because attempts overlap, a slow mirror costs concurrency
 * rather than wall-clock time, so there is no reason to wait 7 s for one.
 */
const PROBE_TIMEOUT_MS = 3_000;

/** How long a leading probe gets before the next one is launched beside it. */
const HEDGE_DELAY_MS = 350;

/** Upper bound on concurrent probes, to stay polite to origins and the proxy. */
const MAX_PARALLEL_PROBES = 4;

interface Session {
  token: number;
  requestId: string;
  mirrors: WorkerMirror[];
  /** Attempt order as indices into `mirrors`, best first. */
  order: number[];
  /** Next position in `order` to launch. */
  cursor: number;
  inflight: Map<number, AbortController>;
  /** Indices that cannot be probed (cross-origin); used only as a last resort. */
  optimistic: number[];
  attempts: number;
  activeIndex: number | null;
  settled: boolean;
  hedgeTimer: ReturnType<typeof setTimeout> | null;
}

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
};

let token = 0;
let session: Session | null = null;

/**
 * Health memory lives for the lifetime of the worker, so switching episodes
 * carries forward everything learned about which servers actually work.
 */
const health: MirrorHealthBook = createHealthBook();

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function clearHedge(active: Session): void {
  if (active.hedgeTimer !== null) {
    clearTimeout(active.hedgeTimer);
    active.hedgeTimer = null;
  }
}

function abortAll(active: Session): void {
  for (const controller of active.inflight.values()) controller.abort();
  active.inflight.clear();
}

function endSession(): void {
  token += 1;
  if (session) {
    clearHedge(session);
    abortAll(session);
  }
  session = null;
}

function isCurrent(active: Session): boolean {
  return session === active && active.token === token;
}

function isValidMirror(value: unknown): value is WorkerMirror {
  if (!value || typeof value !== 'object') return false;
  const mirror = value as Partial<WorkerMirror>;
  return (
    typeof mirror.id === 'string' &&
    typeof mirror.name === 'string' &&
    typeof mirror.url === 'string' &&
    mirror.url.length > 0 &&
    mirror.url.length <= 8192
  );
}

/**
 * Verifies a same-origin proxy endpoint actually returns a rewritten manifest
 * (or a real media body) before the player commits to it.
 */
async function probeMirror(
  mirror: WorkerMirror,
  controller: AbortController,
): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = performance.now();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(mirror.url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.apple.mpegurl, video/*, */*',
        // Progressive files can be hundreds of megabytes; ask for two bytes.
        // The proxy ignores Range for playlists so manifests still validate.
        Range: 'bytes=0-1',
      },
    });
    const kind = response.headers.get('x-aniverse-proxy-kind');
    // Release the connection promptly rather than buffering the body.
    await response.body?.cancel().catch(() => undefined);
    const ok = (response.ok || response.status === 206) && (kind === 'manifest' || kind === 'media');
    return { ok, latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - startedAt) };
  } finally {
    clearTimeout(timeoutId);
  }
}

function connect(active: Session, index: number, latencyMs: number, probed: boolean): void {
  const mirror = active.mirrors[index];
  if (!mirror) return;
  active.settled = true;
  active.activeIndex = index;
  clearHedge(active);
  // Everything still racing is now wasted work.
  for (const [candidateIndex, controller] of active.inflight) {
    if (candidateIndex !== index) controller.abort();
  }
  active.inflight.clear();

  post({
    type: 'STREAM_CONNECTED',
    payload: {
      requestId: active.requestId,
      url: mirror.url,
      latencyMs,
      index,
      id: mirror.id,
      name: mirror.name,
      probed,
      attempts: active.attempts,
    },
  });
}

function criticalFailure(active: Session, message: string): void {
  active.settled = true;
  clearHedge(active);
  abortAll(active);
  post({ type: 'STREAM_CRITICAL_FAILURE', payload: { requestId: active.requestId, message } });
}

/** Launches the next probeable candidate. Non-probeable ones are deferred. */
function launchNext(active: Session): boolean {
  while (active.cursor < active.order.length) {
    const index = active.order[active.cursor];
    active.cursor += 1;
    const mirror = active.mirrors[index];
    if (!mirror) continue;

    if (!mirror.probe) {
      // Cross-origin mirrors cannot be probed without tripping CORS, so they
      // are only used if every verifiable mirror fails.
      active.optimistic.push(index);
      continue;
    }

    const controller = new AbortController();
    active.inflight.set(index, controller);
    active.attempts += 1;

    void probeMirror(mirror, controller).then((result) => {
      if (!isCurrent(active) || active.settled) return;
      active.inflight.delete(index);

      post({
        type: 'MIRROR_PROBE',
        payload: { requestId: active.requestId, index, id: mirror.id, ok: result.ok, latencyMs: result.latencyMs },
      });

      if (result.ok) {
        recordSuccess(health, mirror.id, result.latencyMs);
        connect(active, index, result.latencyMs, true);
        return;
      }

      recordFailure(health, mirror.id);
      // A failure frees capacity: pull the next candidate forward immediately
      // instead of waiting for the hedge timer.
      pump(active);
    });

    return true;
  }
  return false;
}

function scheduleHedge(active: Session): void {
  clearHedge(active);
  if (active.settled) return;
  if (active.cursor >= active.order.length) return;
  if (active.inflight.size === 0) return;
  if (active.inflight.size >= MAX_PARALLEL_PROBES) return;

  active.hedgeTimer = setTimeout(() => {
    if (!isCurrent(active) || active.settled) return;
    active.hedgeTimer = null;
    pump(active);
  }, HEDGE_DELAY_MS);
}

/** Keeps the race saturated and decides when it is over. */
function pump(active: Session): void {
  if (!isCurrent(active) || active.settled) return;

  while (active.inflight.size < MAX_PARALLEL_PROBES && active.cursor < active.order.length) {
    if (!launchNext(active)) break;
    // Hedging means we add one at a time and give it a head start, unless
    // nothing is in flight at all — then keep filling so we never idle.
    if (active.inflight.size > 0) break;
  }

  post({
    type: 'RACE_PROGRESS',
    payload: {
      requestId: active.requestId,
      inFlight: active.inflight.size,
      remaining: active.order.length - active.cursor,
    },
  });

  if (active.inflight.size > 0) {
    scheduleHedge(active);
    return;
  }

  if (active.cursor < active.order.length) {
    // Only non-probeable candidates were skipped on this pass; keep going.
    pump(active);
    return;
  }

  // Every verifiable mirror failed. Fall back to the unverifiable ones and let
  // real media errors drive further failover.
  const next = active.optimistic.shift();
  if (next !== undefined) {
    active.attempts += 1;
    connect(active, next, 0, false);
    return;
  }

  criticalFailure(
    active,
    active.mirrors.length === 0
      ? 'No stream server is configured for this episode.'
      : `All ${active.mirrors.length} stream server${active.mirrors.length === 1 ? '' : 's'} failed to respond.`,
  );
}

function beginRace(requestId: string, mirrors: WorkerMirror[], preferredId: string | null): Session {
  pruneHealthBook(health);
  const order = orderMirrorIndices(
    mirrors.map((mirror, index) => ({ id: mirror.id, priority: mirror.priority ?? index })),
    health,
    Date.now(),
    preferredId,
  );

  token += 1;
  const active: Session = {
    token,
    requestId,
    mirrors,
    order,
    cursor: 0,
    inflight: new Map(),
    optimistic: [],
    attempts: 0,
    activeIndex: null,
    settled: false,
    hedgeTimer: null,
  };
  session = active;
  pump(active);
  return active;
}

/** Resumes racing over whatever candidates remain after a mid-playback failure. */
function resumeRace(previous: Session, excludeIndex: number | null): void {
  clearHedge(previous);
  abortAll(previous);
  token += 1;

  const remainingOrder = previous.order
    .slice(previous.cursor)
    .filter((index) => index !== excludeIndex);
  const remainingOptimistic = previous.optimistic.filter((index) => index !== excludeIndex);

  const active: Session = {
    ...previous,
    token,
    order: remainingOrder,
    cursor: 0,
    inflight: new Map(),
    optimistic: remainingOptimistic,
    activeIndex: null,
    settled: false,
    hedgeTimer: null,
  };
  session = active;

  if (remainingOrder.length === 0 && remainingOptimistic.length === 0) {
    criticalFailure(
      active,
      `All ${previous.mirrors.length} stream server${previous.mirrors.length === 1 ? '' : 's'} failed to play this episode.`,
    );
    return;
  }

  const nextIndex = remainingOrder[0] ?? remainingOptimistic[0];
  const nextMirror = previous.mirrors[nextIndex];
  if (nextMirror) {
    post({
      type: 'FAILOVER_TRIGGERED',
      payload: { requestId: active.requestId, index: nextIndex, id: nextMirror.id, name: nextMirror.name },
    });
  }

  pump(active);
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object' || !('type' in message) || !('payload' in message)) return;

  if (message.type === 'CANCEL_STREAM') {
    if (session && session.requestId === message.payload.requestId) endSession();
    return;
  }

  if (message.type === 'INITIALIZE_STREAM') {
    endSession();
    const mirrors = Array.isArray(message.payload.mirrors)
      ? message.payload.mirrors.filter(isValidMirror)
      : [];
    beginRace(message.payload.requestId, mirrors, message.payload.preferredId ?? null);
    return;
  }

  if (!session || session.requestId !== message.payload.requestId) return;

  if (message.type === 'SELECT_MIRROR') {
    const previous = session;
    const index = message.payload.index;
    if (!Number.isInteger(index) || index < 0 || index >= previous.mirrors.length) return;

    // An explicit choice is honoured immediately — the viewer asked for this
    // server, so it is handed to the player without waiting on a probe.
    clearHedge(previous);
    abortAll(previous);
    token += 1;
    const active: Session = {
      ...previous,
      token,
      inflight: new Map(),
      settled: false,
      activeIndex: null,
      hedgeTimer: null,
      // Anything not chosen stays available for later automatic failover.
      order: previous.order.filter((candidate) => candidate !== index),
      cursor: 0,
      optimistic: previous.optimistic.filter((candidate) => candidate !== index),
    };
    session = active;
    connect(active, index, 0, false);
    return;
  }

  if (message.type === 'TRY_NEXT_MIRROR') {
    const previous = session;
    // Ignore stale failover requests from a mirror we already moved past.
    if (previous.activeIndex !== null && message.payload.fromIndex !== previous.activeIndex) return;

    const failedIndex = previous.activeIndex;
    if (failedIndex !== null) {
      const failedMirror = previous.mirrors[failedIndex];
      if (failedMirror) recordFailure(health, failedMirror.id);
    }
    resumeRace(previous, failedIndex);
  }
});

export {};
