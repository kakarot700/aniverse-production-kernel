'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { EpisodeGrid } from '@/components/EpisodeGrid';
import { MasterPlayer } from '@/components/MasterPlayer';
import { ServerRail } from '@/components/ServerRail';
import { WatchRoomPanel } from '@/components/WatchRoomPanel';
import { useAnimeDetail, useWatchSources } from '@/hooks/useAnimeData';
import { describeRuntime, formatLabel, titleCase } from '@/lib/anime/text';
import type { AnimeSummary } from '@/types/anime';

interface TitleDialogProps {
  summary: AnimeSummary;
  onClose: () => void;
}

function formatPlaybackPosition(positionMs: number): string {
  const seconds = Math.floor(positionMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function TitleDialog({ summary, onClose }: TitleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [requestedMirrorIndex, setRequestedMirrorIndex] = useState<number | null>(null);
  const [activeMirrorIndex, setActiveMirrorIndex] = useState<number | null>(null);

  const { detail, loading: detailLoading } = useAnimeDetail(summary.id, summary);
  const record = detail ?? null;
  const { payload, loading: sourcesLoading, error: sourcesError } = useWatchSources(record ?? summary, episodeNumber);

  const mirrors = useMemo(() => payload?.mirrors ?? [], [payload]);
  const episodes = record?.episodes ?? [];
  const activeEpisode = episodes.find((episode) => episode.number === episodeNumber) ?? null;

  useEffect(() => {
    setEpisodeNumber(1);
    setRequestedMirrorIndex(null);
    setPositionMs(0);
  }, [summary.id]);

  useEffect(() => {
    setRequestedMirrorIndex(null);
  }, [episodeNumber]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, []);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };

  const handleProgress = useCallback((next: number) => setPositionMs(next), []);
  const handleVideoElement = useCallback((element: HTMLVideoElement | null) => setVideoElement(element), []);
  const handleActiveMirror = useCallback((index: number | null) => setActiveMirrorIndex(index), []);

  const meta = [
    record?.year ?? summary.year,
    formatLabel(record?.format ?? summary.format),
    describeRuntime(record ?? summary),
    record?.status ? titleCase(record.status.replace(/_/g, ' ')) : null,
    (record?.studios ?? summary.studios)[0] ?? null,
  ].filter(Boolean);

  const score = (record?.averageScore ?? summary.averageScore) ?? null;
  const banner = record?.bannerImage ?? summary.bannerImage;
  const episodeLabel = activeEpisode
    ? `${summary.title} — episode ${activeEpisode.number}`
    : `${summary.title} — episode ${episodeNumber}`;

  return (
    <dialog ref={dialogRef} className="player-modal" aria-labelledby="player-title" onCancel={handleCancel}>
      {banner ? (
        <div className="modal-banner" aria-hidden="true">
          <img src={banner} alt="" referrerPolicy="no-referrer" />
        </div>
      ) : null}

      <div className="modal-topline">
        <div className="modal-copy">
          <p className="eyebrow">
            {(record?.genres ?? summary.genres).slice(0, 3).join(' · ') || 'Anime'}
            {score != null ? ` · ★ ${(score / 10).toFixed(1)}` : ''}
          </p>
          <h2 id="player-title">{summary.title}</h2>
          <p className="modal-meta">{meta.join(' · ')}</p>
          <p className="modal-synopsis">{record?.synopsis ?? summary.synopsis}</p>
          {record?.titles.native ? <p className="modal-native">{record.titles.native}</p> : null}
        </div>
        <button ref={closeButtonRef} className="icon-button" type="button" aria-label="Close player" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="player-layout">
        <div className="player-column">
          <MasterPlayer
            mirrors={mirrors}
            poster={summary.coverImage}
            episodeLabel={episodeLabel}
            loading={sourcesLoading}
            requestedMirrorIndex={requestedMirrorIndex}
            onProgress={handleProgress}
            onVideoElement={handleVideoElement}
            onActiveMirrorChange={handleActiveMirror}
          />
          <div className="player-subline">
            <span className="player-position">Playhead {formatPlaybackPosition(positionMs)}</span>
            <span className="player-episode">
              {activeEpisode ? `Ep ${activeEpisode.number} · ${activeEpisode.title}` : `Episode ${episodeNumber}`}
            </span>
          </div>

          {sourcesError ? <p className="inline-error">{sourcesError}</p> : null}

          <ServerRail
            mirrors={mirrors}
            activeIndex={requestedMirrorIndex ?? activeMirrorIndex}
            loading={sourcesLoading}
            notice={payload?.notice ?? null}
            onSelect={setRequestedMirrorIndex}
          />

          {activeEpisode?.officialUrl ? (
            <p className="official-link">
              Licensed stream:{' '}
              <a href={activeEpisode.officialUrl} target="_blank" rel="noreferrer noopener">
                watch episode {activeEpisode.number} on {activeEpisode.officialSite ?? 'the official service'}
              </a>
            </p>
          ) : null}

          {record?.trailer ? (
            <p className="official-link">
              <a href={record.trailer.url} target="_blank" rel="noreferrer noopener">
                Watch the official trailer
              </a>
            </p>
          ) : null}

          {detailLoading && episodes.length === 0 ? (
            <p className="episode-empty">Loading episodes…</p>
          ) : (
            <EpisodeGrid episodes={episodes} activeEpisode={episodeNumber} onSelect={setEpisodeNumber} />
          )}
        </div>

        <WatchRoomPanel video={videoElement} />
      </div>
    </dialog>
  );
}
