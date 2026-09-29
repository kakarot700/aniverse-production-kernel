'use client';

import Hls from 'hls.js';
import { useEffect, useState, type RefObject } from 'react';
import type { MediaEpisodePayload } from '@/types/media';

interface MasterPlayerProps {
  episode: MediaEpisodePayload;
  poster: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onProgress: (positionMs: number) => void;
}

type WorkerEvent =
  | { type: 'STREAM_CONNECTED'; payload: { requestId: string; url: string; latencyMs: number; activeMirror: number } }
  | { type: 'FAILOVER_TRIGGERED'; payload: { requestId: string; newIdx: number } }
  | { type: 'STREAM_CRITICAL_FAILURE'; payload: { requestId: string; message: string } };

export function MasterPlayer({ episode, poster, videoRef, onProgress }: MasterPlayerProps) {
  const [status, setStatus] = useState('');
  const [fatalError, setFatalError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const mirrors = episode.mirrors.map((mirror) => mirror.manifestUrl).filter(Boolean);
    if (mirrors.length === 0) {
      setFatalError('No authorized HLS stream source is attached to this demo title.');
      setStatus('Playback is not configured.');
      return;
    }

    const requestId = crypto.randomUUID();
    const worker = new Worker(new URL('../core/stream.worker.ts', import.meta.url), { type: 'module' });
    let hls: Hls | null = null;
    let currentSource = '';
    let lastProgressAt = 0;
    let lastSkipPoint = '';
    setFatalError('');
    setStatus('Checking authorized stream mirrors…');

    const releaseHls = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      video.removeAttribute('src');
      video.load();
    };

    const attachSource = (url: string) => {
      if (currentSource === url) return;
      currentSource = url;
      releaseHls();

      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          setStatus('This mirror stopped responding; checking the next one…');
          releaseHls();
          worker.postMessage({ type: 'TRY_NEXT_MIRROR', payload: { requestId } });
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.load();
      } else {
        setFatalError('This browser cannot play HLS video. Try a recent Safari, Chrome, or Firefox.');
      }
    };

    const handleWorkerMessage = (event: MessageEvent<WorkerEvent>) => {
      const message = event.data;
      if (!message?.payload || message.payload.requestId !== requestId) return;
      if (message.type === 'STREAM_CONNECTED') {
        setFatalError('');
        setStatus(`Mirror ${message.payload.activeMirror + 1} responded in ${message.payload.latencyMs} ms.`);
        attachSource(message.payload.url);
      } else if (message.type === 'FAILOVER_TRIGGERED') {
        setStatus(`Trying mirror ${message.payload.newIdx + 1}…`);
        currentSource = '';
        releaseHls();
      } else {
        setFatalError(message.payload.message);
        setStatus('Playback could not connect.');
      }
    };

    const handleTimeUpdate = () => {
      const now = performance.now();
      if (now - lastProgressAt > 400) {
        lastProgressAt = now;
        onProgress(Math.max(0, Math.floor(video.currentTime * 1000)));
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
    worker.postMessage({ type: 'INITIALIZE_STREAM', payload: { requestId, mirrors } });

    return () => {
      worker.removeEventListener('message', handleWorkerMessage);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      worker.postMessage({ type: 'CANCEL_STREAM', payload: { requestId } });
      worker.terminate();
      releaseHls();
    };
  }, [episode, onProgress, videoRef]);

  return (
    <>
      <div className="player-stage">
        <video ref={videoRef} controls playsInline preload="metadata" poster={poster} aria-label={`Video player: ${episode.episodeTitle}`} />
        {fatalError ? (
          <div className="player-empty" aria-live="polite">
            <div><strong>{fatalError}</strong><p>Playback stays disabled until an authorized HLS source is configured in the catalog and its host is allowlisted on the server.</p></div>
          </div>
        ) : null}
      </div>
      <p className="player-status" aria-live="polite">{status}</p>
    </>
  );
}
