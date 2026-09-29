'use client';

import Hls from 'hls.js';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MediaEpisodePayload, StreamMirrorNode } from '@/types/media';
import type { WorkerMirror } from '@/core/stream.worker';

export interface MirrorProbe {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

interface MasterPlayerProps {
  episode: MediaEpisodePayload;
  mirrors: StreamMirrorNode[];
  poster: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onProgress: (positionMs: number) => void;
  /** Empty string means "let the failover worker choose". */
  selectedServerId: string;
  onProbe: (serverId: string, probe: MirrorProbe) => void;
  onActiveServer: (serverId: string) => void;
  /** `true` while the title's detail payload is still loading. */
  loading?: boolean;
}

type WorkerEvent =
  | { type: 'STREAM_CONNECTED'; payload: { requestId: string; url: string; serverId: string; latencyMs: number; activeMirror: number } }
  | { type: 'FAILOVER_TRIGGERED'; payload: { requestId: string; newIdx: number; serverId: string } }
  | { type: 'MIRROR_PROBED'; payload: { requestId: string; serverId: string; ok: boolean; latencyMs: number; detail?: string } }
  | { type: 'STREAM_CRITICAL_FAILURE'; payload: { requestId: string; message: string } };

/** Mirrors the player can attach to directly (embeds are handled separately). */
function streamableMirrors(mirrors: StreamMirrorNode[]): StreamMirrorNode[] {
  return mirrors.filter((mirror) => mirror.status === 'ready' && mirror.kind !== 'embed' && mirror.manifestUrl);
}

export function MasterPlayer({
  episode,
  mirrors,
  poster,
  videoRef,
  onProgress,
  selectedServerId,
  onProbe,
  onActiveServer,
  loading = false,
}: MasterPlayerProps) {
  const [status, setStatus] = useState('');
  const [fatalError, setFatalError] = useState('');

  // Callbacks live in refs so a parent re-render never restarts playback.
  const callbacks = useRef({ onProgress, onProbe, onActiveServer });
  callbacks.current = { onProgress, onProbe, onActiveServer };

  const selectedMirror = useMemo(
    () => mirrors.find((mirror) => mirror.serverId === selectedServerId && mirror.status === 'ready'),
    [mirrors, selectedServerId],
  );

  const isEmbed = selectedMirror?.kind === 'embed' && Boolean(selectedMirror.embedUrl);

  /**
   * Ordered list handed to the worker. A manual selection is moved to the
   * front so failover continues from there rather than restarting at tier 0.
   */
  const workerMirrors = useMemo<WorkerMirror[]>(() => {
    const streamable = streamableMirrors(mirrors);
    const ordered = selectedServerId
      ? [
          ...streamable.filter((mirror) => mirror.serverId === selectedServerId),
          ...streamable.filter((mirror) => mirror.serverId !== selectedServerId),
        ]
      : streamable;
    return ordered.map((mirror) => ({
      serverId: mirror.serverId,
      url: mirror.manifestUrl,
      requiresProxy: mirror.requiresProxy,
    }));
  }, [mirrors, selectedServerId]);

  // Stable identity for the effect: restart only when the actual mirror set
  // or the episode changes, not on every parent render.
  const mirrorKey = useMemo(
    () => `${episode.episodeNumber}::${workerMirrors.map((mirror) => `${mirror.serverId}@${mirror.url}`).join('|')}`,
    [episode.episodeNumber, workerMirrors],
  );

  useEffect(() => {
    if (isEmbed || loading) return;

    const video = videoRef.current;
    if (!video) return;

    if (workerMirrors.length === 0) {
      setFatalError('No playable stream server is attached to this episode yet.');
      setStatus('');
      return;
    }

    const requestId = crypto.randomUUID();
    const worker = new Worker(new URL('../core/stream.worker.ts', import.meta.url), { type: 'module' });
    let hls: Hls | null = null;
    let currentSource = '';
    let lastProgressAt = 0;
    let lastSkipPoint = '';
    let disposed = false;

    setFatalError('');
    setStatus('Checking stream servers…');

    const releaseHls = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      video.removeAttribute('src');
      video.load();
    };

    const attachSource = (url: string) => {
      if (disposed || currentSource === url) return;
      currentSource = url;
      releaseHls();

      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || disposed) return;
          setStatus('That server stopped responding; trying the next one…');
          releaseHls();
          currentSource = '';
          worker.postMessage({ type: 'TRY_NEXT_MIRROR', payload: { requestId } });
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.load();
      } else {
        setFatalError('This browser cannot play HLS video. Try a recent Safari, Chrome, or Firefox.');
        setStatus('');
      }
    };

    const handleWorkerMessage = (event: MessageEvent<WorkerEvent>) => {
      const message = event.data;
      if (!message?.payload || message.payload.requestId !== requestId || disposed) return;

      switch (message.type) {
        case 'MIRROR_PROBED':
          callbacks.current.onProbe(message.payload.serverId, {
            ok: message.payload.ok,
            latencyMs: message.payload.latencyMs,
            detail: message.payload.detail,
          });
          return;
        case 'STREAM_CONNECTED':
          setFatalError('');
          setStatus(`Connected in ${message.payload.latencyMs} ms.`);
          callbacks.current.onActiveServer(message.payload.serverId);
          attachSource(message.payload.url);
          return;
        case 'FAILOVER_TRIGGERED':
          setStatus('Trying the next server…');
          currentSource = '';
          releaseHls();
          return;
        case 'STREAM_CRITICAL_FAILURE':
          setFatalError(message.payload.message);
          setStatus('');
          return;
        default:
          return;
      }
    };

    const handleTimeUpdate = () => {
      const now = performance.now();
      if (now - lastProgressAt > 400) {
        lastProgressAt = now;
        callbacks.current.onProgress(Math.max(0, Math.floor(video.currentTime * 1000)));
      }

      const skip = episode.skipTimestamps;
      if (!skip) return;
      if (video.currentTime >= skip.introStart && video.currentTime < skip.introEnd && lastSkipPoint !== 'intro') {
        lastSkipPoint = 'intro';
        video.currentTime = skip.introEnd;
      } else if (video.currentTime >= skip.outroStart && video.currentTime < skip.outroEnd && lastSkipPoint !== 'outro') {
        lastSkipPoint = 'outro';
        video.currentTime = skip.outroEnd;
      } else if (video.currentTime > skip.introEnd && video.currentTime < skip.outroStart) {
        lastSkipPoint = '';
      }
    };

    worker.addEventListener('message', handleWorkerMessage);
    video.addEventListener('timeupdate', handleTimeUpdate);
    worker.postMessage({ type: 'INITIALIZE_STREAM', payload: { requestId, mirrors: workerMirrors } });

    return () => {
      disposed = true;
      worker.removeEventListener('message', handleWorkerMessage);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      worker.postMessage({ type: 'CANCEL_STREAM', payload: { requestId } });
      worker.terminate();
      releaseHls();
    };
    // `mirrorKey` collapses the mirror array into a primitive so the effect
    // does not restart on unrelated parent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirrorKey, isEmbed, loading, videoRef, episode.skipTimestamps]);

  if (loading) {
    return (
      <>
        <div className="player-stage">
          <div className="player-empty" aria-live="polite">
            <div>
              <strong>Loading stream servers…</strong>
              <p>Resolving mirrors for this episode.</p>
            </div>
          </div>
        </div>
        <p className="player-status" aria-live="polite" />
      </>
    );
  }

  if (isEmbed && selectedMirror?.embedUrl) {
    return (
      <>
        <div className="player-stage">
          <iframe
            className="player-embed"
            src={selectedMirror.embedUrl}
            title={`${selectedMirror.serverName} player: ${episode.episodeTitle}`}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
        <p className="player-status" aria-live="polite">
          Playing through {selectedMirror.serverName}. Watch-room sync is unavailable for embedded players.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="player-stage">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={poster}
          aria-label={`Video player: ${episode.episodeTitle}`}
        />
        {fatalError ? (
          <div className="player-empty" aria-live="polite">
            <div>
              <strong>{fatalError}</strong>
              <p>
                Pick another server below, or map this episode in your source map and allowlist its host. Open{' '}
                <code>/api/servers</code> to see exactly which servers are configured.
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <p className="player-status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
