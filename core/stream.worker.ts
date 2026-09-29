/**
 * Bounded mirror probing and failover.
 *
 * Runs off the main thread so a slow or dead mirror never blocks rendering.
 *
 * Fixes over the previous revision:
 *  - honours `requiresProxy`: direct mirrors are probed at their own origin
 *    instead of being forced through `/api/proxy`;
 *  - emits a `MIRROR_PROBED` result per mirror so the server rail can show
 *    real per-server health and latency instead of a single status string;
 *  - the retry loop no longer depends on a `connecting` flag that could be
 *    cleared by a `finally` block while the same loop was still iterating;
 *  - `fail()` reports against the request id it was started with, so a late
 *    failure from a cancelled request can no longer surface in a new one.
 */

export interface WorkerMirror {
  /** Registry server id, echoed back in probe results. */
  serverId: string;
  /** Absolute https manifest URL. */
  url: string;
  /** When true, probe/playback go through the same-origin proxy. */
  requiresProxy: boolean;
}

type WorkerRequest =
  | { type: 'INITIALIZE_STREAM'; payload: { requestId: string; mirrors: WorkerMirror[] } }
  | { type: 'TRY_NEXT_MIRROR'; payload: { requestId: string } }
  | { type: 'SELECT_MIRROR'; payload: { requestId: string; serverId: string } }
  | { type: 'CANCEL_STREAM'; payload: { requestId: string } };

type WorkerResponse =
  | {
      type: 'STREAM_CONNECTED';
      payload: { requestId: string; url: string; serverId: string; latencyMs: number; activeMirror: number };
    }
  | { type: 'FAILOVER_TRIGGERED'; payload: { requestId: string; newIdx: number; serverId: string } }
  | {
      type: 'MIRROR_PROBED';
      payload: { requestId: string; serverId: string; ok: boolean; latencyMs: number; detail?: string };
    }
  | { type: 'STREAM_CRITICAL_FAILURE'; payload: { requestId: string; message: string } };

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
  location: Location;
};

const PROBE_TIMEOUT_MS = 6000;

let requestId = '';
let mirrors: WorkerMirror[] = [];
let activeIndex = 0;
let activeController: AbortController | null = null;
/** Bumped whenever the in-flight probe chain is invalidated. */
let generation = 0;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function fail(forRequestId: string, message: string): void {
  if (!forRequestId || forRequestId !== requestId) return;
  post({ type: 'STREAM_CRITICAL_FAILURE', payload: { requestId: forRequestId, message } });
}

function reset(): void {
  generation += 1;
  activeController?.abort();
  activeController = null;
}

function probeUrlFor(mirror: WorkerMirror): string {
  if (!mirror.requiresProxy) return mirror.url;
  const proxyUrl = new URL('/api/proxy', scope.location.origin);
  proxyUrl.searchParams.set('url', mirror.url);
  return proxyUrl.toString();
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object' || !('type' in message) || !('payload' in message)) return;

  switch (message.type) {
    case 'CANCEL_STREAM': {
      if (message.payload.requestId !== requestId) return;
      reset();
      mirrors = [];
      requestId = '';
      return;
    }

    case 'INITIALIZE_STREAM': {
      reset();
      requestId = message.payload.requestId;
      mirrors = (message.payload.mirrors ?? []).filter(
        (mirror): mirror is WorkerMirror =>
          Boolean(mirror) && typeof mirror.url === 'string' && mirror.url.startsWith('https://'),
      );
      activeIndex = 0;
      void runProbeChain(generation, requestId);
      return;
    }

    case 'SELECT_MIRROR': {
      if (message.payload.requestId !== requestId) return;
      const index = mirrors.findIndex((mirror) => mirror.serverId === message.payload.serverId);
      if (index < 0) return;
      reset();
      activeIndex = index;
      void runProbeChain(generation, requestId, /* singleShot */ true);
      return;
    }

    case 'TRY_NEXT_MIRROR': {
      if (message.payload.requestId !== requestId) return;
      reset();
      if (activeIndex + 1 >= mirrors.length) {
        fail(requestId, 'All configured stream mirrors are unavailable.');
        return;
      }
      activeIndex += 1;
      post({
        type: 'FAILOVER_TRIGGERED',
        payload: { requestId, newIdx: activeIndex, serverId: mirrors[activeIndex]?.serverId ?? '' },
      });
      void runProbeChain(generation, requestId);
      return;
    }

    default:
      return;
  }
});

interface ProbeOutcome {
  ok: boolean;
  latencyMs: number;
  url: string;
  detail?: string;
}

async function probe(mirror: WorkerMirror, signal: AbortSignal): Promise<ProbeOutcome> {
  const startedAt = performance.now();
  const url = probeUrlFor(mirror);

  try {
    const response = await fetch(url, { signal, cache: 'no-store' });
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, latencyMs, url, detail: `HTTP ${response.status}` };
    }

    // Proxied mirrors are authenticated by the proxy's own marker header.
    if (mirror.requiresProxy) {
      const kind = response.headers.get('x-aniverse-proxy-kind');
      await response.body?.cancel();
      if (kind !== 'manifest') return { ok: false, latencyMs, url, detail: 'Not a playlist' };
      return { ok: true, latencyMs, url };
    }

    // Direct mirrors are validated by sniffing the playlist header.
    const text = (await response.text()).trimStart();
    if (!text.startsWith('#EXTM3U')) return { ok: false, latencyMs, url, detail: 'Not a playlist' };
    return { ok: true, latencyMs, url };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const detail = error instanceof DOMException && error.name === 'AbortError' ? 'Timed out' : 'Unreachable';
    return { ok: false, latencyMs, url, detail };
  }
}

/**
 * Walks mirrors from `activeIndex` until one answers with a real playlist.
 *
 * `probeGeneration` is captured at entry; every await re-checks it, so a
 * cancel/reinit immediately orphans the old chain without needing shared
 * mutable "am I still connecting" state.
 */
async function runProbeChain(probeGeneration: number, chainRequestId: string, singleShot = false): Promise<void> {
  if (probeGeneration !== generation || !chainRequestId) return;

  if (mirrors.length === 0) {
    fail(chainRequestId, 'No playable stream mirrors are configured for this episode.');
    return;
  }

  while (probeGeneration === generation && chainRequestId === requestId) {
    const mirrorIndex = activeIndex;
    const mirror = mirrors[mirrorIndex];
    if (!mirror) {
      fail(chainRequestId, 'All configured stream mirrors are unavailable.');
      return;
    }

    const controller = new AbortController();
    activeController = controller;
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    let outcome: ProbeOutcome;
    try {
      outcome = await probe(mirror, controller.signal);
    } finally {
      clearTimeout(timeoutId);
      if (activeController === controller) activeController = null;
    }

    if (probeGeneration !== generation || chainRequestId !== requestId) return;

    post({
      type: 'MIRROR_PROBED',
      payload: {
        requestId: chainRequestId,
        serverId: mirror.serverId,
        ok: outcome.ok,
        latencyMs: outcome.latencyMs,
        detail: outcome.detail,
      },
    });

    if (outcome.ok) {
      post({
        type: 'STREAM_CONNECTED',
        payload: {
          requestId: chainRequestId,
          url: outcome.url,
          serverId: mirror.serverId,
          latencyMs: outcome.latencyMs,
          activeMirror: mirrorIndex,
        },
      });
      return;
    }

    if (singleShot) {
      fail(chainRequestId, `${mirror.serverId} did not respond with a playable stream.`);
      return;
    }

    if (mirrorIndex + 1 >= mirrors.length) {
      fail(chainRequestId, 'All configured stream mirrors are unavailable.');
      return;
    }

    activeIndex = mirrorIndex + 1;
    post({
      type: 'FAILOVER_TRIGGERED',
      payload: { requestId: chainRequestId, newIdx: activeIndex, serverId: mirrors[activeIndex]?.serverId ?? '' },
    });
  }
}

export {};
