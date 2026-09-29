export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 9_000;
const DEFAULT_RETRIES = 1;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UpstreamError('Request aborted.', 0, false));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * fetch with a hard timeout, bounded retries and Retry-After awareness.
 * Works unchanged in the Node runtime and in the browser, which is what lets
 * the client fall back to querying AniList directly when our own server has no
 * outbound network access.
 */
export async function requestJson<T>(
  input: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  let lastError: unknown;
  let retryAfterMs = 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw new UpstreamError('Request aborted.', 0, false);

    const controller = new AbortController();
    const abortOuter = () => controller.abort();
    options.signal?.addEventListener('abort', abortOuter, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.status === 429 || response.status >= 500) {
        const retryAfterSeconds = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
        await response.body?.cancel();
        retryAfterMs = Number.isFinite(retryAfterSeconds)
          ? Math.min(5_000, Math.max(0, retryAfterSeconds) * 1000)
          : 0;
        throw new UpstreamError(`Upstream responded ${response.status}.`, response.status, true);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new UpstreamError(
          `Upstream responded ${response.status}. ${detail.slice(0, 200)}`.trim(),
          response.status,
          false,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof UpstreamError ? error.retryable : true;
      if (!retryable || attempt === retries || options.signal?.aborted) break;
      await delay(Math.max(retryAfterMs, 350 * (attempt + 1)), options.signal);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortOuter);
    }
  }

  if (lastError instanceof UpstreamError) throw lastError;
  const message = lastError instanceof Error ? lastError.message : 'Unknown upstream failure.';
  throw new UpstreamError(message, 0, false);
}
