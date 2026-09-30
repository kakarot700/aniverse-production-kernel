'use client';

import Hls, { type ErrorData, type Level } from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isProbeable, playbackUrlFor, mirrorsSignature } from '@/lib/stream-url';
import type { SkipTimestamps, StreamMirrorNode } from '@/types/media';
import type { WorkerRequest, WorkerResponse } from '@/core/stream.worker';

interface MasterPlayerProps {
  mirrors: StreamMirrorNode[];
  poster: string;
  episodeLabel: string;
  skipTimestamps?: SkipTimestamps;
  loading?: boolean;
  /** Index into `mirrors` the viewer explicitly picked, or null for automatic. */
  requestedMirrorIndex?: number | null;
  onProgress?: (positionMs: number) => void;
  onVideoElement?: (element: HTMLVideoElement | null) => void;
  onActiveMirrorChange?: (index: number | null) => void;
}

interface QualityLevel {
  index: number;
  label: string;
}

const MAX_MEDIA_RECOVERIES = 2;

function describeLevel(level: Level, index: number): QualityLevel {
  const height = level.height ? `${level.height}p` : `${Math.round((level.bitrate ?? 0) / 1000)} kbps`;
  return { index, label: height };
}

export function MasterPlayer({
  mirrors,
  poster,
  episodeLabel,
  skipTimestamps,
  loading = false,
  requestedMirrorIndex = null,
  onProgress,
  onVideoElement,
  onActiveMirrorChange,
}: MasterPlayerProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState('');
  const [fatalError, setFatalError] = useState('');
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [skipHint, setSkipHint] = useState<'intro' | 'outro' | null>(null);

  const mirrorsRef = useRef(mirrors);
  mirrorsRef.current = mirrors;
  const signature = useMemo(() => mirrorsSignature(mirrors), [mirrors]);

  const callbacksRef = useRef({ onProgress, onActiveMirrorChange });
  callbacksRef.current = { onProgress, onActiveMirrorChange };

  const skipRef = useRef(skipTimestamps);
  skipRef.current = skipTimestamps;

  const hlsRef = useRef<Hls | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const activeIndexRef = useRef<number | null>(null);
  const requestIdRef = useRef('');

  const videoCallbackRef = useCallback((element: HTMLVideoElement | null) => {
    setVideo(element);
  }, []);

  useEffect(() => {
    onVideoElement?.(video);
    return () => onVideoElement?.(null);
  }, [onVideoElement, video]);

  // Viewer-selected server.
  useEffect(() => {
    if (requestedMirrorIndex == null) return;
    const worker = workerRef.current;
    if (!worker || !requestIdRef.current) return;
    if (activeIndexRef.current === requestedMirrorIndex) return;
    const message: WorkerRequest = {
      type: 'SELECT_MIRROR',
      payload: { requestId: requestIdRef.current, index: requestedMirrorIndex },
    };
    worker.postMessage(message);
  }, [requestedMirrorIndex, signature]);

  useEffect(() => {
    if (!video) return;
    const currentMirrors = mirrorsRef.current;

    setLevels([]);
    setCurrentLevel(-1);
    setSkipHint(null);
    activeIndexRef.current = null;
    callbacksRef.current.onActiveMirrorChange?.(null);

    if (loading) {
      requestIdRef.current = '';
      setFatalError('');
      setStatus('Loading stream servers…');
      return;
    }

    if (currentMirrors.length === 0) {
      requestIdRef.current = '';
      setFatalError('No stream server is available for this episode yet.');
      setStatus('');
      return;
    }

    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    setFatalError('');
    setStatus(`Checking ${currentMirrors.length} stream server${currentMirrors.length === 1 ? '' : 's'}…`);

    const worker = new Worker(new URL('../core/stream.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    let mediaRecoveries = 0;
    let attachedUrl = '';
    let lastProgressAt = 0;
    let lastSkipPoint: 'intro' | 'outro' | '' = '';
    let disposed = false;

    const send = (message: WorkerRequest) => {
      if (!disposed) worker.postMessage(message);
    };

    const releaseHls = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // Safari can throw when load() races teardown; the element is discarded anyway.
      }
    };

    const failover = () => {
      const index = activeIndexRef.current;
      if (index == null) return;
      releaseHls();
      attachedUrl = '';
      send({ type: 'TRY_NEXT_MIRROR', payload: { requestId, fromIndex: index } });
    };

    const attachSource = (url: string, index: number) => {
      if (attachedUrl === url) return;
      attachedUrl = url;
      mediaRecoveries = 0;
      releaseHls();

      const mirror = mirrorsRef.current[index];
      const isProgressive = mirror?.kind === 'mp4';

      if (isProgressive || (!Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl'))) {
        video.src = url;
        video.load();
        return;
      }

      if (!Hls.isSupported()) {
        if (video.canPlayType('video/mp4')) {
          video.src = url;
          video.load();
          return;
        }
        setFatalError('This browser cannot play HLS video. Try a recent Chrome, Edge, Firefox or Safari.');
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        // Low-latency mode is for LL-HLS live edges; on VOD it causes needless
        // partial-segment requests and stalls.
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 12_000,
            maxLoadTimeMs: 60_000,
            timeoutRetry: { maxNumRetry: 2, retryDelayMs: 500, maxRetryDelayMs: 4_000 },
            errorRetry: { maxNumRetry: 3, retryDelayMs: 800, maxRetryDelayMs: 8_000 },
          },
        },
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(hls.levels.map(describeLevel));
        setCurrentLevel(hls.currentLevel);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => setCurrentLevel(data.level));
      hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details !== Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
          setStatus('Network hiccup on this server; retrying…');
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < MAX_MEDIA_RECOVERIES) {
          mediaRecoveries += 1;
          setStatus('Recovering the decoder…');
          hls.recoverMediaError();
          return;
        }
        setStatus('This server stopped responding; switching to the next one…');
        failover();
      });

      hls.loadSource(url);
      hls.attachMedia(video);
    };

    const handleWorkerMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (!message?.payload || message.payload.requestId !== requestId) return;

      if (message.type === 'STREAM_CONNECTED') {
        activeIndexRef.current = message.payload.index;
        callbacksRef.current.onActiveMirrorChange?.(message.payload.index);
        setFatalError('');
        setStatus(
          message.payload.probed
            ? `${message.payload.name} responded in ${message.payload.latencyMs} ms.`
            : `Playing from ${message.payload.name}.`,
        );
        attachSource(message.payload.url, message.payload.index);
        return;
      }

      if (message.type === 'FAILOVER_TRIGGERED') {
        activeIndexRef.current = message.payload.index;
        callbacksRef.current.onActiveMirrorChange?.(message.payload.index);
        setStatus(`Trying ${message.payload.name}…`);
        attachedUrl = '';
        releaseHls();
        return;
      }

      if (message.type === 'STREAM_CRITICAL_FAILURE') {
        activeIndexRef.current = null;
        callbacksRef.current.onActiveMirrorChange?.(null);
        setFatalError(message.payload.message);
        setStatus('');
        releaseHls();
      }
    };

    const handleTimeUpdate = () => {
      const now = performance.now();
      if (now - lastProgressAt > 400) {
        lastProgressAt = now;
        callbacksRef.current.onProgress?.(Math.max(0, Math.floor(video.currentTime * 1000)));
      }

      const skip = skipRef.current;
      if (!skip) return;
      const time = video.currentTime;
      if (time >= skip.introStart && time < skip.introEnd) {
        if (lastSkipPoint !== 'intro') setSkipHint('intro');
      } else if (time >= skip.outroStart && time < skip.outroEnd) {
        if (lastSkipPoint !== 'outro') setSkipHint('outro');
      } else {
        setSkipHint(null);
        if (time < skip.introStart || (time > skip.introEnd && time < skip.outroStart)) lastSkipPoint = '';
      }
    };

    const handleNativeError = () => {
      // Only meaningful on the native/progressive path; hls.js reports its own
      // errors. Tearing a source down also fires `error` with an empty src, so
      // ignore anything that is not a real decode/network failure.
      if (hlsRef.current) return;
      if (!video.getAttribute('src')) return;
      if (!video.error || video.error.code === MediaError.MEDIA_ERR_ABORTED) return;
      setStatus('This server could not be played here; switching…');
      failover();
    };

    worker.addEventListener('message', handleWorkerMessage);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('error', handleNativeError);

    send({
      type: 'INITIALIZE_STREAM',
      payload: {
        requestId,
        startIndex: 0,
        mirrors: currentMirrors.map((mirror) => ({
          id: mirror.id,
          name: mirror.serverName,
          url: playbackUrlFor(mirror),
          probe: isProbeable(mirror),
        })),
      },
    });

    return () => {
      disposed = true;
      worker.removeEventListener('message', handleWorkerMessage);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('error', handleNativeError);
      worker.postMessage({ type: 'CANCEL_STREAM', payload: { requestId } } satisfies WorkerRequest);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      requestIdRef.current = '';
      releaseHls();
    };
  }, [loading, signature, video]);

  const applySkip = () => {
    const skip = skipRef.current;
    if (!video || !skip || !skipHint) return;
    video.currentTime = skipHint === 'intro' ? skip.introEnd : skip.outroEnd;
    setSkipHint(null);
  };

  const changeLevel = (value: number) => {
    setCurrentLevel(value);
    if (hlsRef.current) hlsRef.current.currentLevel = value;
  };

  return (
    <>
      <div className="player-stage">
        <video
          ref={videoCallbackRef}
          controls
          playsInline
          preload="metadata"
          poster={poster}
          crossOrigin="anonymous"
          aria-label={`Video player: ${episodeLabel}`}
        />
        {skipHint ? (
          <button type="button" className="skip-button" onClick={applySkip}>
            Skip {skipHint}
          </button>
        ) : null}
        {fatalError ? (
          <div className="player-empty" aria-live="polite">
            <div>
              <strong>{fatalError}</strong>
              <p>
                Pick a different server below, or add a licensed URL in an <code>ANIVERSE_SERVER_XX_URL</code> slot so
                this title resolves to media you are allowed to stream.
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <div className="player-toolbar">
        <p className="player-status" aria-live="polite">
          {status}
        </p>
        {levels.length > 1 ? (
          <label className="quality-select">
            <span className="sr-only">Video quality</span>
            <select value={currentLevel} onChange={(event) => changeLevel(Number(event.target.value))}>
              <option value={-1}>Auto</option>
              {levels.map((level) => (
                <option key={level.index} value={level.index}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </>
  );
}
