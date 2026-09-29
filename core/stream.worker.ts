/**
 * Mirror probing + failover worker.
 *
 * Runs off the main thread so a slow or dead server never blocks the UI. It
 * walks the ranked mirror list supplied by the stream-server registry, probes
 * the same-origin proxy endpoints it can verify cheaply, and reports the first
 * mirror that answers. Every command bumps a session token, so late responses
 * from an abandoned attempt are discarded instead of racing the current one.
 */
export interface WorkerMirror {
  id: string;
  name: string;
  /** Final URL the player should load (already proxied when required). */
  url: string;
  /** Same-origin proxy URLs can be verified before we hand them to hls.js. */
  probe: boolean;
}

export type WorkerRequest =
  | { type: 'INITIALIZE_STREAM'; payload: { requestId: string; mirrors: WorkerMirror[]; startIndex?: number } }
  | { type: 'TRY_NEXT_MIRROR'; payload: { requestId: string; fromIndex: number } }
  | { type: 'SELECT_MIRROR'; payload: { requestId: string; index: number } }
  | { type: 'CANCEL_STREAM'; payload: { requestId: string } };

export type WorkerResponse =
  | {
      type: 'STREAM_CONNECTED';
      payload: { requestId: string; url: string; latencyMs: number; index: number; id: string; name: string; probed: boolean };
    }
  | { type: 'MIRROR_PROBE'; payload: { requestId: string; index: number; id: string; ok: boolean; latencyMs: number } }
  | { type: 'FAILOVER_TRIGGERED'; payload: { requestId: string; index: number; id: string; name: string } }
  | { type: 'STREAM_CRITICAL_FAILURE'; payload: { requestId: string; message: string } };

const PROBE_TIMEOUT_MS = 7_000;

interface Session {
  token: number;
  requestId: string;
  mirrors: WorkerMirror[];
  index: number;
  controller: AbortController | null;
}

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
};

let token = 0;
let session: Session | null = null;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function endSession(): void {
  token += 1;
  session?.controller?.abort();
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
async function probeMirror(mirror: WorkerMirror, controller: AbortController): Promise<{ ok: boolean; latencyMs: number }> {
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

async function advance(active: Session, startIndex: number): Promise<void> {
  for (let index = startIndex; index < active.mirrors.length; index += 1) {
    if (!isCurrent(active)) return;
    active.index = index;
    const mirror = active.mirrors[index];

    if (index > startIndex || startIndex > 0) {
      post({
        type: 'FAILOVER_TRIGGERED',
        payload: { requestId: active.requestId, index, id: mirror.id, name: mirror.name },
      });
    }

    if (!mirror.probe) {
      // Cross-origin mirrors cannot be probed without tripping CORS, so hand
      // them straight to the player and let media errors drive failover.
      post({
        type: 'STREAM_CONNECTED',
        payload: {
          requestId: active.requestId,
          url: mirror.url,
          latencyMs: 0,
          index,
          id: mirror.id,
          name: mirror.name,
          probed: false,
        },
      });
      return;
    }

    const controller = new AbortController();
    active.controller = controller;
    const result = await probeMirror(mirror, controller);
    if (active.controller === controller) active.controller = null;
    if (!isCurrent(active)) return;

    post({
      type: 'MIRROR_PROBE',
      payload: { requestId: active.requestId, index, id: mirror.id, ok: result.ok, latencyMs: result.latencyMs },
    });

    if (result.ok) {
      post({
        type: 'STREAM_CONNECTED',
        payload: {
          requestId: active.requestId,
          url: mirror.url,
          latencyMs: result.latencyMs,
          index,
          id: mirror.id,
          name: mirror.name,
          probed: true,
        },
      });
      return;
    }
  }

  if (!isCurrent(active)) return;
  post({
    type: 'STREAM_CRITICAL_FAILURE',
    payload: {
      requestId: active.requestId,
      message:
        active.mirrors.length === 0
          ? 'No stream server is configured for this episode.'
          : `All ${active.mirrors.length} stream server${active.mirrors.length === 1 ? '' : 's'} failed to respond.`,
    },
  });
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
    token += 1;
    const mirrors = Array.isArray(message.payload.mirrors) ? message.payload.mirrors.filter(isValidMirror) : [];
    const startIndex = Math.min(Math.max(0, message.payload.startIndex ?? 0), Math.max(0, mirrors.length - 1));
    const active: Session = {
      token,
      requestId: message.payload.requestId,
      mirrors,
      index: startIndex,
      controller: null,
    };
    session = active;
    void advance(active, startIndex);
    return;
  }

  if (!session || session.requestId !== message.payload.requestId) return;

  if (message.type === 'SELECT_MIRROR') {
    const previous = session;
    const index = message.payload.index;
    if (!Number.isInteger(index) || index < 0 || index >= previous.mirrors.length) return;
    endSession();
    token += 1;
    const active: Session = { ...previous, token, index, controller: null };
    session = active;
    void advance(active, index);
    return;
  }

  if (message.type === 'TRY_NEXT_MIRROR') {
    const previous = session;
    // Ignore stale failover requests from a mirror we already moved past.
    if (message.payload.fromIndex !== previous.index) return;
    endSession();
    token += 1;
    const nextIndex = previous.index + 1;
    if (nextIndex >= previous.mirrors.length) {
      post({
        type: 'STREAM_CRITICAL_FAILURE',
        payload: {
          requestId: previous.requestId,
          message: `All ${previous.mirrors.length} stream server${previous.mirrors.length === 1 ? '' : 's'} failed to play this episode.`,
        },
      });
      return;
    }
    const active: Session = { ...previous, token, index: nextIndex, controller: null };
    session = active;
    void advance(active, nextIndex);
  }
});

export {};
