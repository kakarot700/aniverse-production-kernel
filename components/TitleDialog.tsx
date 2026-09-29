'use client';

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { EpisodeRail } from '@/components/EpisodeRail';
import { MasterPlayer, type MirrorProbe } from '@/components/MasterPlayer';
import { ServerRail } from '@/components/ServerRail';
import { WatchRoomPanel } from '@/components/WatchRoomPanel';
import type { UserLibrary } from '@/hooks/useUserLibrary';
import type { MediaCatalogRecord, MediaEpisodePayload, StreamMirrorNode } from '@/types/media';

interface TitleDialogProps {
  /** Namespaced catalog id. The dialog is addressable by id alone, so an
   *  invite link can open the same title for every peer. */
  mediaId: string;
  /** Record already in hand from the grid, for an instant header render. */
  preview?: MediaCatalogRecord | null;
  initialEpisode?: number;
  onEpisodeChange?: (episodeNumber: number) => void;
  onClose: () => void;
  library: UserLibrary;
  signedIn: boolean;
}

interface DetailResponse {
  record: MediaCatalogRecord;
  episode: number;
  mirrors: StreamMirrorNode[];
  sourceMapConfigured: boolean;
  degraded?: string;
}

function formatPlaybackPosition(positionMs: number): string {
  const totalSeconds = Math.floor(positionMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  // Films run past the 60-minute mark, where `108:23` is unreadable.
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  return `${minutes}:${paddedSeconds}`;
}

const FALLBACK_EPISODE: MediaEpisodePayload = { episodeNumber: 1, episodeTitle: 'Episode 1', mirrors: [] };

function placeholderRecord(mediaId: string): MediaCatalogRecord {
  return {
    id: mediaId,
    title: 'Loading…',
    synopsis: '',
    coverPoster: '',
    genre: '',
    genres: [],
    year: 0,
    format: '',
    episodeCount: 0,
    source: 'offline',
    episodes: [],
  };
}

export function TitleDialog({
  mediaId,
  preview,
  initialEpisode = 1,
  onEpisodeChange,
  onClose,
  library,
  signedIn,
}: TitleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [episodeNumber, setEpisodeNumber] = useState(initialEpisode);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [activeServerId, setActiveServerId] = useState('');
  const [health, setHealth] = useState<Record<string, MirrorProbe>>({});
  const [positionMs, setPositionMs] = useState(0);

  // Resume point is captured once per episode: reading it live would make the
  // player chase its own progress writes.
  const [resumeAtMs, setResumeAtMs] = useState(0);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const onProgress = useCallback(
    (next: number) => {
      setPositionMs(next);
      libraryRef.current.saveProgress(mediaId, episodeNumber, next);
    },
    [mediaId, episodeNumber],
  );
  const onProbe = useCallback(
    (serverId: string, probe: MirrorProbe) => setHealth((current) => ({ ...current, [serverId]: probe })),
    [],
  );
  const onActiveServer = useCallback((serverId: string) => setActiveServerId(serverId), []);

  // Native <dialog> lifecycle + focus restoration.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, []);

  // Fetch title detail + the resolved mirror rail for the chosen episode.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setResumeAtMs(libraryRef.current.resumeFor(mediaId, episodeNumber));

    fetch(`/api/catalog/${encodeURIComponent(mediaId)}?episode=${episodeNumber}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error((await response.json().catch(() => ({}))).error ?? `Request failed (${response.status}).`);
        }
        return (await response.json()) as DetailResponse;
      })
      .then((payload) => {
        setDetail(payload);
        setHealth({});
        setActiveServerId('');
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load this title.');
        setLoading(false);
      });

    return () => controller.abort();
  }, [mediaId, episodeNumber]);

  const record = detail?.record ?? preview ?? placeholderRecord(mediaId);
  const episodes = record.episodes.length ? record.episodes : [FALLBACK_EPISODE];
  const episode = episodes.find((entry) => entry.episodeNumber === episodeNumber) ?? episodes[0] ?? FALLBACK_EPISODE;
  const mirrors = detail?.mirrors ?? [];

  // A cross-origin embed cannot be read or driven by the parent page, so the
  // watch room has nothing to synchronise.
  const selectedMirror = mirrors.find((mirror) => mirror.serverId === selectedServerId && mirror.status === 'ready');
  const isEmbed = selectedMirror?.kind === 'embed' && Boolean(selectedMirror.embedUrl);
  const hasVideoElement = !loading && !isEmbed;

  // Bumped whenever the <video> element mounts, so the watch room re-binds its
  // listeners instead of holding a ref that was null when it first ran.
  const videoEpoch = hasVideoElement ? episode.episodeNumber * 2 + 1 : 0;

  const saved = library.isSaved(mediaId);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };

  const handleSelectEpisode = (next: number) => {
    setEpisodeNumber(next);
    setPositionMs(0);
    onEpisodeChange?.(next);
  };

  return (
    <dialog ref={dialogRef} className="player-modal" aria-labelledby="player-title" onCancel={handleCancel}>
      <div className="modal-topline">
        <div className="modal-copy">
          <p className="eyebrow">
            {record.genres.slice(0, 3).join(' · ') || record.genre}
            {record.year ? ` · ${record.year}` : ''}
          </p>
          <h2 id="player-title">{record.title}</h2>
          {record.titleNative && record.titleNative !== record.title ? (
            <p className="modal-native">{record.titleNative}</p>
          ) : null}
          <p>{record.synopsis}</p>
          <p className="modal-facts">
            {record.format}
            {record.studios?.length ? ` · ${record.studios.slice(0, 2).join(', ')}` : ''}
            {typeof record.score === 'number' ? ` · ${record.score}% rated` : ''}
          </p>
        </div>
        <div className="modal-actions">
          {signedIn ? (
            <button
              type="button"
              className={`save-button${saved ? ' is-saved' : ''}`}
              aria-pressed={saved}
              onClick={() => void library.toggleWatchlist(mediaId)}
            >
              <span aria-hidden="true">{saved ? '✓' : '+'}</span>
              {saved ? 'In your list' : 'Add to list'}
            </button>
          ) : null}
          <button ref={closeButtonRef} className="icon-button" type="button" aria-label="Close player" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      {loadError ? (
        <p className="modal-banner modal-banner-error" role="status">
          {loadError}
        </p>
      ) : null}
      {detail?.degraded ? (
        <p className="modal-banner" role="status">
          {detail.degraded}
        </p>
      ) : null}
      {library.error ? (
        <p className="modal-banner modal-banner-error" role="status">
          {library.error}
        </p>
      ) : null}

      <div className="player-layout">
        <div className="player-column">
          <MasterPlayer
            episode={episode}
            mirrors={mirrors}
            poster={record.bannerImage || record.coverPoster}
            videoRef={videoRef}
            onProgress={onProgress}
            selectedServerId={selectedServerId}
            onProbe={onProbe}
            onActiveServer={onActiveServer}
            loading={loading}
            resumeAtMs={resumeAtMs}
          />
          <p className="player-position" aria-live="off">
            {episode.episodeTitle} · Playhead {formatPlaybackPosition(positionMs)}
          </p>

          <ServerRail
            mirrors={mirrors}
            health={health}
            activeServerId={activeServerId}
            selectedServerId={selectedServerId}
            onSelect={setSelectedServerId}
            sourceMapConfigured={detail?.sourceMapConfigured ?? false}
          />

          <EpisodeRail episodes={episodes} selected={episode.episodeNumber} onSelect={handleSelectEpisode} />

          {record.legalStreams?.length ? (
            <section className="legal-rail" aria-labelledby="legal-rail-title">
              <h3 id="legal-rail-title">Watch officially</h3>
              <p>Licensed services that carry this title.</p>
              <div className="legal-links">
                {record.legalStreams.slice(0, 8).map((link) => (
                  <a
                    key={`${link.site}-${link.url}`}
                    className="legal-link"
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {link.site}
                    {link.language ? <span>{link.language}</span> : null}
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <WatchRoomPanel
          videoRef={videoRef}
          videoEpoch={videoEpoch}
          unavailableReason={
            isEmbed
              ? 'Watch-together sync is unavailable while an embedded third-party player is selected. Pick an HLS server to sync.'
              : ''
          }
        />
      </div>
    </dialog>
  );
}
