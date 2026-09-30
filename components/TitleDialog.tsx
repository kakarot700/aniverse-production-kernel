'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { EpisodeGrid } from '@/components/EpisodeGrid';
import { MasterPlayer } from '@/components/MasterPlayer';
import { ServerRail } from '@/components/ServerRail';
import { WatchRoomPanel } from '@/components/WatchRoomPanel';
import { useAnimeDetail, useWatchSources } from '@/hooks/useAnimeData';
import { useLibrary } from '@/hooks/useLibrary';
import { useSkipTimes } from '@/hooks/useSkipTimes';
import { describeRuntime, formatLabel, titleCase } from '@/lib/anime/text';
import type { AnimeSummary } from '@/types/anime';

/** Writing to storage on every timeupdate is wasteful; 5 s is plenty. */
const PROGRESS_SAVE_INTERVAL_MS = 5_000;

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

  const [resumeSeconds, setResumeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const { detail, loading: detailLoading } = useAnimeDetail(summary.id, summary);
  const record = detail ?? null;
  const { payload, loading: sourcesLoading, error: sourcesError } = useWatchSources(record ?? summary, episodeNumber);

  const library = useLibrary();
  // Read the library through a ref inside effects: its callbacks change
  // identity whenever stored state changes, and depending on them directly
  // would re-run the resume logic on every progress save.
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const mirrors = useMemo(() => payload?.mirrors ?? [], [payload]);
  const episodes = record?.episodes ?? [];
  const activeEpisode = episodes.find((episode) => episode.number === episodeNumber) ?? null;
  const episodeCount = record?.episodes.length || record?.episodeCount || summary.episodeCount || null;
  const isSaved = library.isSaved(summary.id);

  // Taste signals stored alongside progress so recommendations can be built
  // from local history alone, without re-fetching every watched title.
  const genresForLibrary = record?.genres ?? summary.genres;
  const studiosForLibrary = record?.studios ?? summary.studios;
  const formatForLibrary = record?.format ?? summary.format;

  // AniSkip is keyed by MyAnimeList id and needs the real runtime, so this
  // stays dormant until the player reports a duration.
  const skipTimestamps = useSkipTimes(record?.malId ?? summary.malId, episodeNumber, durationSeconds);

  const openedTitleRef = useRef('');
  const resumeKeyRef = useRef('');
  const lastSaveAtRef = useRef(0);
  const lastKnownRef = useRef({ positionMs: 0, durationMs: 0, episodeNumber: 1 });

  useEffect(() => {
    setEpisodeNumber(1);
    setRequestedMirrorIndex(null);
    setPositionMs(0);
  }, [summary.id]);

  useEffect(() => {
    setRequestedMirrorIndex(null);
    setDurationSeconds(0);
  }, [episodeNumber]);

  // Warm the next episode's server list so hitting "next" resolves instantly
  // instead of waiting on a fresh round trip. Fire-and-forget; a failure here
  // costs nothing because the real request will run normally.
  useEffect(() => {
    if (!episodeCount || episodeNumber >= episodeCount) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/watch/${encodeURIComponent(summary.id)}/${episodeNumber + 1}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }).catch(() => undefined);
    }, 2_500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [episodeCount, episodeNumber, summary.id]);

  // Open on the episode the viewer was last on, once storage has been read.
  useEffect(() => {
    if (!library.ready) return;
    if (openedTitleRef.current === summary.id) return;
    openedTitleRef.current = summary.id;
    const entry = libraryRef.current.continueRow.find((item) => item.mediaId === summary.id);
    if (entry) setEpisodeNumber(entry.episodeNumber);
  }, [library.ready, summary.id]);

  // Resolve the resume point once per episode, never mid-playback — otherwise
  // a manual scrub would be yanked back to the stored position.
  useEffect(() => {
    if (!library.ready) return;
    const key = `${summary.id}::${episodeNumber}`;
    if (resumeKeyRef.current === key) return;
    resumeKeyRef.current = key;
    setResumeSeconds(libraryRef.current.resumeFor(summary.id, episodeNumber) / 1000);
  }, [library.ready, summary.id, episodeNumber]);

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

  const titleForLibrary = record?.title ?? summary.title;
  const coverForLibrary = record?.coverImage ?? summary.coverImage;

  const handleProgress = useCallback(
    (next: number, durationMs: number) => {
      setPositionMs(next);
      lastKnownRef.current = { positionMs: next, durationMs, episodeNumber };
      if (durationMs > 0) {
        const seconds = durationMs / 1000;
        // Only update on a real change; this feeds the AniSkip lookup key.
        setDurationSeconds((current) => (Math.abs(current - seconds) > 1 ? seconds : current));
      }

      const now = Date.now();
      if (now - lastSaveAtRef.current < PROGRESS_SAVE_INTERVAL_MS) return;
      lastSaveAtRef.current = now;
      libraryRef.current.saveProgress({
        mediaId: summary.id,
        episodeNumber,
        positionMs: next,
        durationMs,
        title: titleForLibrary,
        coverImage: coverForLibrary,
        episodeCount,
        genres: genresForLibrary,
        studios: studiosForLibrary,
        format: formatForLibrary,
      });
    },
    [
      coverForLibrary, episodeCount, episodeNumber, formatForLibrary, genresForLibrary,
      studiosForLibrary, summary.id, titleForLibrary,
    ],
  );

  // Closing the dialog (or switching episode) must not lose the last few
  // seconds of progress that the throttle was still holding.
  useEffect(() => {
    return () => {
      const last = lastKnownRef.current;
      if (last.positionMs <= 0) return;
      libraryRef.current.saveProgress({
        mediaId: summary.id,
        episodeNumber: last.episodeNumber,
        positionMs: last.positionMs,
        durationMs: last.durationMs,
        title: titleForLibrary,
        coverImage: coverForLibrary,
        episodeCount,
        genres: genresForLibrary,
        studios: studiosForLibrary,
        format: formatForLibrary,
      });
    };
  }, [
    coverForLibrary, episodeCount, formatForLibrary, genresForLibrary,
    studiosForLibrary, summary.id, titleForLibrary,
  ]);

  const handleToggleSaved = useCallback(() => {
    libraryRef.current.toggleSaved({
      mediaId: summary.id,
      title: titleForLibrary,
      coverImage: coverForLibrary,
      genres: genresForLibrary,
      studios: studiosForLibrary,
      format: formatForLibrary,
    });
  }, [coverForLibrary, formatForLibrary, genresForLibrary, studiosForLibrary, summary.id, titleForLibrary]);

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
        <div className="modal-actions">
          <button
            type="button"
            className={isSaved ? 'button-quiet is-saved' : 'button-quiet'}
            aria-pressed={isSaved}
            onClick={handleToggleSaved}
          >
            <span aria-hidden="true">{isSaved ? '★' : '☆'}</span> {isSaved ? 'In your list' : 'Add to list'}
          </button>
          <button ref={closeButtonRef} className="icon-button" type="button" aria-label="Close player" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      <div className="player-layout">
        <div className="player-column">
          <MasterPlayer
            mirrors={mirrors}
            poster={summary.coverImage}
            episodeLabel={episodeLabel}
            loading={sourcesLoading}
            requestedMirrorIndex={requestedMirrorIndex}
            skipTimestamps={skipTimestamps ?? undefined}
            startPositionSeconds={resumeSeconds}
            onProgress={handleProgress}
            onVideoElement={handleVideoElement}
            onActiveMirrorChange={handleActiveMirror}
          />
          <div className="player-subline">
            <span className="player-position">Playhead {formatPlaybackPosition(positionMs)}</span>
            {resumeSeconds > 0 ? (
              <span className="player-resume">Resuming from {formatPlaybackPosition(resumeSeconds * 1000)}</span>
            ) : null}
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
