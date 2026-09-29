type WorkerRequest =
  | { type: 'INITIALIZE_STREAM'; payload: { requestId: string; mirrors: string[] } }
  | { type: 'TRY_NEXT_MIRROR'; payload: { requestId: string } }
  | { type: 'CANCEL_STREAM'; payload: { requestId: string } };

type WorkerResponse =
  | { type: 'STREAM_CONNECTED'; payload: { requestId: string; url: string; latencyMs: number; activeMirror: number } }
  | { type: 'FAILOVER_TRIGGERED'; payload: { requestId: string; newIdx: number } }
  | { type: 'STREAM_CRITICAL_FAILURE'; payload: { requestId: string; message: string } };

const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
  location: Location;
};

let requestId = '';
let mirrors: string[] = [];
let activeIndex = 0;
let activeController: AbortController | null = null;
let connecting = false;
let generation = 0;

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object' || !('type' in message) || !('payload' in message)) return;

  if (message.type === 'CANCEL_STREAM') {
    if (message.payload.requestId === requestId) {
      generation += 1;
      activeController?.abort();
      activeController = null;
      mirrors = [];
      requestId = '';
      connecting = false;
    }
    return;
  }

  if (message.type === 'INITIALIZE_STREAM') {
    generation += 1;
    activeController?.abort();
    requestId = message.payload.requestId;
    mirrors = message.payload.mirrors.filter((url) => typeof url === 'string' && url.startsWith('https://'));
    activeIndex = 0;
    connecting = false;
    void probeCurrentMirror(generation);
    return;
  }

  if (message.type === 'TRY_NEXT_MIRROR' && message.payload.requestId === requestId) {
    generation += 1;
    activeController?.abort();
    connecting = false;
    if (activeIndex + 1 >= mirrors.length) {
      fail('All configured stream mirrors are unavailable.');
      return;
    }
    activeIndex += 1;
    scope.postMessage({ type: 'FAILOVER_TRIGGERED', payload: { requestId, newIdx: activeIndex } });
    void probeCurrentMirror(generation);
  }
});

async function probeCurrentMirror(probeGeneration: number): Promise<void> {
  if (probeGeneration !== generation || connecting || !requestId) return;
  if (mirrors.length === 0) {
    fail('No authorized stream sources are configured.');
    return;
  }
  connecting = true;
  const thisRequestId = requestId;
  while (probeGeneration === generation && thisRequestId === requestId) {
    const mirrorIndex = activeIndex;
    const target = mirrors[mirrorIndex];
    const startedAt = performance.now();
    const controller = new AbortController();
    activeController = controller;
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let retry = false;

    try {
      const proxyUrl = new URL('/api/proxy', scope.location.origin);
      proxyUrl.searchParams.set('url', target);
      const response = await fetch(proxyUrl.toString(), { signal: controller.signal, cache: 'no-store' });
      const proxyKind = response.headers.get('x-aniverse-proxy-kind');
      if (!response.ok || proxyKind !== 'manifest') throw new Error('Mirror probe failed.');
      if (probeGeneration !== generation) return;
      scope.postMessage({
        type: 'STREAM_CONNECTED',
        payload: { requestId: thisRequestId, url: proxyUrl.toString(), latencyMs: Math.round(performance.now() - startedAt), activeMirror: mirrorIndex },
      });
      return;
    } catch {
      if (probeGeneration !== generation || controller.signal.aborted && activeController !== controller) return;
      if (mirrorIndex + 1 < mirrors.length) {
        activeIndex = mirrorIndex + 1;
        scope.postMessage({ type: 'FAILOVER_TRIGGERED', payload: { requestId: thisRequestId, newIdx: activeIndex } });
        retry = true;
      } else {
        fail('All configured stream mirrors are unavailable.');
        return;
      }
    } finally {
      clearTimeout(timeoutId);
      if (activeController === controller) activeController = null;
      if (probeGeneration === generation) connecting = false;
    }
    if (!retry) return;
    if (probeGeneration !== generation) return;
    connecting = true;
  }
}

function fail(message: string): void {
  if (!requestId) return;
  scope.postMessage({ type: 'STREAM_CRITICAL_FAILURE', payload: { requestId, message } });
}

export {};
