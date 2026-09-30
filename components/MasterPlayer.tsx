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
  /** Seconds to resume from on first play, from the continue-watching library. */
  startPositionSeconds?: number;
  onProgress?: (positionMs: number, durationMs: number) => void;
  onVideoElement?: (element: HTMLVideoElement | null) => void;
  onActiveMirrorChange?: (index: number | null) => void;
}

interface QualityLevel {
  index: number;
  label: string;
}

const MAX_MEDIA_RECOVERIES = 2;

/**
 * The server that last worked is remembered across episodes and reloads, so a
 * viewer who found a good mirror is not re-raced onto a worse one every time.
 * The worker still overrides this if that server is in its cooldown window.
 */
const PREFERRED_SERVER_KEY = 'aniverse:preferred-server';
const VOLUME_KEY = 'aniverse:volume';

function readPreferredServerId(): string | null {
  try {
    return window.localStorage.getItem(PREFERRED_SERVER_KEY);
  } catch {
    // Private mode or a blocked storage partition; preference is optional.
    return null;
  }
}

function writePreferredServerId(id: string): void {
  try {
    window.localStorage.setItem(PREFERRED_SERVER_KEY, id);
  } catch {
    // Ignore: losing the preference only costs one extra probe next time.
  }
}

const AUTO_SKIP_KEY = 'aniverse:auto-skip';

export interface PlaybackStats {
  resolution: string;
  bitrateKbps: number | null;
  bufferAheadSeconds: number;
  droppedFrames: number | null;
  levelCount: number;
  connectionMs: number | null;
  serverName: string;
}

function readAutoSkip(): boolean {
  try {
    return window.localStorage.getItem(AUTO_SKIP_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeAutoSkip(value: boolean): void {
  try {
    window.localStorage.setItem(AUTO_SKIP_KEY, String(value));
  } catch {
    // Non-fatal.
  }
}

/** Volume and mute survive episode changes and reloads, like any real player. */
function readStoredVolume(): { volume: number; muted: boolean } | null {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
    const volume = typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : 1;
    return { volume, muted: parsed.muted === true };
  } catch {
    return null;
  }
}

function writeStoredVolume(volume: number, muted: boolean): void {
  try {
    window.localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
  } catch {
    // Non-fatal.
  }
}

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
  startPositionSeconds = 0,
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
  const [pipAvailable, setPipAvailable] = useState(false);
  const [autoSkip, setAutoSkip] = useState(readAutoSkip);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<PlaybackStats | null>(null);

  // Read through a ref so changing the resume point never restarts the race.
  const startPositionRef = useRef(startPositionSeconds);
  startPositionRef.current = startPositionSeconds;

  const mirrorsRef = useRef(mirrors);
  mirrorsRef.current = mirrors;
  const signature = useMemo(() => mirrorsSignature(mirrors), [mirrors]);

  const callbacksRef = useRef({ onProgress, onActiveMirrorChange });
  callbacksRef.current = { onProgress, onActiveMirrorChange };

  const skipRef = useRef(skipTimestamps);
  skipRef.current = skipTimestamps;

  const autoSkipRef = useRef(autoSkip);
  autoSkipRef.current = autoSkip;

  const connectionRef = useRef<{ latencyMs: number | null; name: string }>({ latencyMs: null, name: '' });

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

  // Restore the viewer's volume, then keep it in sync.
  useEffect(() => {
    if (!video) return;
    const stored = readStoredVolume();
    if (stored) {
      video.volume = stored.volume;
      video.muted = stored.muted;
    }
    setPipAvailable(
      typeof document !== 'undefined' &&
        'pictureInPictureEnabled' in document &&
        document.pictureInPictureEnabled,
    );

    const persist = () => writeStoredVolume(video.volume, video.muted);
    video.addEventListener('volumechange', persist);
    return () => video.removeEventListener('volumechange', persist);
  }, [video]);

  // Keyboard shortcuts. The player lives inside a modal dialog, so listening
  // on the document is safe, but typing in the search box or a room field must
  // never scrub the video.
  useEffect(() => {
    if (!video) return;

    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
    };

    const nudge = (seconds: number) => {
      const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
      video.currentTime = Math.min(Math.max(0, video.currentTime + seconds), duration);
    };

    const setVolume = (delta: number) => {
      video.volume = Math.min(1, Math.max(0, video.volume + delta));
      if (video.volume > 0) video.muted = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          if (video.paused) void video.play().catch(() => undefined);
          else video.pause();
          return;
        case 'ArrowLeft':
          event.preventDefault();
          nudge(-5);
          return;
        case 'ArrowRight':
          event.preventDefault();
          nudge(5);
          return;
        case 'j':
        case 'J':
          event.preventDefault();
          nudge(-10);
          return;
        case 'l':
        case 'L':
          event.preventDefault();
          nudge(10);
          return;
        case 'ArrowUp':
          event.preventDefault();
          setVolume(0.05);
          return;
        case 'ArrowDown':
          event.preventDefault();
          setVolume(-0.05);
          return;
        case 'm':
        case 'M':
          event.preventDefault();
          video.muted = !video.muted;
          return;
        case 'f':
        case 'F':
          event.preventDefault();
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else void video.requestFullscreen?.().catch(() => undefined);
          return;
        default:
          break;
      }

      // 0–9 jump to that tenth of the episode.
      if (/^[0-9]$/.test(event.key) && Number.isFinite(video.duration) && video.duration > 0) {
        event.preventDefault();
        video.currentTime = (Number(event.key) / 10) * video.duration;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [video]);

  // Sample playback telemetry while the stats overlay is open. Polling only
  // while visible keeps this off the hot path when nobody is looking.
  useEffect(() => {
    if (!showStats || !video) return;

    const sample = () => {
      const hls = hlsRef.current;
      const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;

      let bufferAhead = 0;
      for (let index = 0; index < video.buffered.length; index += 1) {
        if (video.buffered.start(index) <= video.currentTime && video.currentTime <= video.buffered.end(index)) {
          bufferAhead = video.buffered.end(index) - video.currentTime;
          break;
        }
      }

      const quality = video.getVideoPlaybackQuality?.();
      setStats({
        resolution: level?.height
          ? `${level.width ?? '?'}×${level.height}`
          : video.videoWidth
            ? `${video.videoWidth}×${video.videoHeight}`
            : '—',
        bitrateKbps: level?.bitrate ? Math.round(level.bitrate / 1000) : null,
        bufferAheadSeconds: Math.max(0, bufferAhead),
        droppedFrames: quality ? quality.droppedVideoFrames : null,
        levelCount: hls ? hls.levels.length : 0,
        connectionMs: connectionRef.current.latencyMs,
        serverName: connectionRef.current.name,
      });
    };

    sample();
    const timer = window.setInterval(sample, 1_000);
    return () => window.clearInterval(timer);
  }, [showStats, video]);

  const togglePictureInPicture = useCallback(() => {
    if (!video) return;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => undefined);
      return;
    }
    void video.requestPictureInPicture?.().catch(() => undefined);
  }, [video]);

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
    // Where to pick playback back up: the continue-watching position on the
    // first attach, and after that the playhead captured before a mid-episode
    // server switch — so a failover costs a buffering pause, not a restart.
    let resumeAtSeconds = startPositionRef.current > 0 ? startPositionRef.current : 0;
    let pendingSeek: (() => void) | null = null;

    const send = (message: WorkerRequest) => {
      if (!disposed) worker.postMessage(message);
    };

    const releaseHls = () => {
      if (pendingSeek) {
        video.removeEventListener('loadedmetadata', pendingSeek);
        pendingSeek = null;
      }
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
      // Capture the playhead *before* tearing the source down; after
      // `load()` the element reports 0 and the position is gone.
      const position = video.currentTime;
      if (Number.isFinite(position) && position > 1) resumeAtSeconds = position;
      releaseHls();
      attachedUrl = '';
      send({ type: 'TRY_NEXT_MIRROR', payload: { requestId, fromIndex: index } });
    };

    const armResumeSeek = () => {
      if (resumeAtSeconds <= 0) return;
      const target = resumeAtSeconds;
      const seek = () => {
        pendingSeek = null;
        resumeAtSeconds = 0;
        // A shorter re-encode on another mirror must not seek past the end.
        const duration = video.duration;
        const safeTarget = Number.isFinite(duration) && duration > 0 ? Math.min(target, duration - 1) : target;
        if (safeTarget <= 0) return;
        try {
          video.currentTime = safeTarget;
        } catch {
          // Some sources reject a seek before the first fragment lands; the
          // viewer keeps playback from the start rather than losing the stream.
        }
      };
      pendingSeek = seek;
      video.addEventListener('loadedmetadata', seek, { once: true });
    };

    const attachSource = (url: string, index: number) => {
      if (attachedUrl === url) return;
      attachedUrl = url;
      mediaRecoveries = 0;
      releaseHls();
      armResumeSeek();

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
        writePreferredServerId(message.payload.id);
        connectionRef.current = {
          latencyMs: message.payload.probed ? message.payload.latencyMs : null,
          name: message.payload.name,
        };
        const raced =
          message.payload.attempts > 1 ? ` (won a ${message.payload.attempts}-way race)` : '';
        setStatus(
          message.payload.probed
            ? `${message.payload.name} responded in ${message.payload.latencyMs} ms${raced}.`
            : `Playing from ${message.payload.name}.`,
        );
        attachSource(message.payload.url, message.payload.index);
        return;
      }

      if (message.type === 'RACE_PROGRESS') {
        if (activeIndexRef.current === null && message.payload.inFlight > 0) {
          setStatus(
            `Racing ${message.payload.inFlight} server${message.payload.inFlight === 1 ? '' : 's'}…` +
              (message.payload.remaining > 0 ? ` ${message.payload.remaining} in reserve.` : ''),
          );
        }
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
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        callbacksRef.current.onProgress?.(
          Math.max(0, Math.floor(video.currentTime * 1000)),
          Math.floor(duration * 1000),
        );
      }

      const skip = skipRef.current;
      if (!skip) return;
      const time = video.currentTime;
      const inIntro = skip.introEnd > skip.introStart && time >= skip.introStart && time < skip.introEnd;
      const inOutro = skip.outroEnd > skip.outroStart && time >= skip.outroStart && time < skip.outroEnd;

      if (inIntro) {
        // Auto-skip jumps once per segment. `lastSkipPoint` is the guard: a
        // viewer who deliberately seeks back into the opening is not fought.
        if (autoSkipRef.current && lastSkipPoint !== 'intro') {
          lastSkipPoint = 'intro';
          video.currentTime = skip.introEnd;
          setSkipHint(null);
          return;
        }
        if (lastSkipPoint !== 'intro') setSkipHint('intro');
      } else if (inOutro) {
        if (autoSkipRef.current && lastSkipPoint !== 'outro') {
          lastSkipPoint = 'outro';
          video.currentTime = skip.outroEnd;
          setSkipHint(null);
          return;
        }
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
        preferredId: readPreferredServerId(),
        mirrors: currentMirrors.map((mirror) => ({
          id: mirror.id,
          name: mirror.serverName,
          url: playbackUrlFor(mirror),
          probe: isProbeable(mirror),
          priority: mirror.priority,
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

  const toggleAutoSkip = () => {
    setAutoSkip((current) => {
      writeAutoSkip(!current);
      return !current;
    });
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
        {showStats && stats ? (
          <div className="stats-overlay" role="status" aria-live="off">
            <dl>
              <div><dt>Server</dt><dd>{stats.serverName || '—'}</dd></div>
              <div><dt>Connected in</dt><dd>{stats.connectionMs != null ? `${stats.connectionMs} ms` : 'not probed'}</dd></div>
              <div><dt>Resolution</dt><dd>{stats.resolution}</dd></div>
              <div><dt>Bitrate</dt><dd>{stats.bitrateKbps != null ? `${stats.bitrateKbps.toLocaleString()} kbps` : '—'}</dd></div>
              <div><dt>Buffer ahead</dt><dd>{stats.bufferAheadSeconds.toFixed(1)} s</dd></div>
              <div><dt>Dropped frames</dt><dd>{stats.droppedFrames ?? '—'}</dd></div>
              <div><dt>Renditions</dt><dd>{stats.levelCount || '—'}</dd></div>
            </dl>
          </div>
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
        <div className="player-tools">
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
          {skipTimestamps ? (
            <button
              type="button"
              className={autoSkip ? 'button-quiet player-tool is-on' : 'button-quiet player-tool'}
              aria-pressed={autoSkip}
              onClick={toggleAutoSkip}
              title="Automatically skip openings and endings when timestamps are available"
            >
              Auto-skip {autoSkip ? 'on' : 'off'}
            </button>
          ) : null}
          <button
            type="button"
            className={showStats ? 'button-quiet player-tool is-on' : 'button-quiet player-tool'}
            aria-pressed={showStats}
            onClick={() => setShowStats((current) => !current)}
            title="Playback statistics"
          >
            Stats
          </button>
          {pipAvailable ? (
            <button
              type="button"
              className="button-quiet player-tool"
              onClick={togglePictureInPicture}
              title="Picture in picture (p)"
            >
              Pop out
            </button>
          ) : null}
          <details className="shortcut-help">
            <summary title="Keyboard shortcuts">Keys</summary>
            <dl>
              <div><dt>Space / K</dt><dd>Play or pause</dd></div>
              <div><dt>← / →</dt><dd>Back or forward 5s</dd></div>
              <div><dt>J / L</dt><dd>Back or forward 10s</dd></div>
              <div><dt>↑ / ↓</dt><dd>Volume</dd></div>
              <div><dt>M</dt><dd>Mute</dd></div>
              <div><dt>F</dt><dd>Fullscreen</dd></div>
              <div><dt>0–9</dt><dd>Jump to that tenth</dd></div>
            </dl>
          </details>
        </div>
      </div>
    </>
  );
}
