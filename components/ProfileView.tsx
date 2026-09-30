'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { TitleDialog } from '@/components/TitleDialog';
import { stubSummaryFor } from '@/components/LibraryShelf';
import { useLibrary } from '@/hooks/useLibrary';
import { computeStats, formatWatchTime } from '@/lib/user-data/stats';
import type { AnimeSummary } from '@/types/anime';

type Tab = 'watching' | 'list';

/**
 * The viewer's own page.
 *
 * Everything here is derived from local storage, so it works with no account
 * and no network. That is a deliberate product position, not a limitation:
 * the list is useful from the first episode rather than after a signup flow.
 */
export function ProfileView() {
  const library = useLibrary();
  const [tab, setTab] = useState<Tab>('watching');
  const [selected, setSelected] = useState<AnimeSummary | null>(null);

  const stats = useMemo(() => computeStats(library.state), [library.state]);

  // `ready` is false until the effect has read storage. Rendering the empty
  // state before then would flash "nothing here yet" at people who do have
  // a library.
  if (!library.ready) {
    return (
      <div className="page">
        <ProfileHead />
        <div className="stat-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => <div className="card-skeleton stat-skeleton" key={index} />)}
        </div>
      </div>
    );
  }

  const isEmpty = stats.titlesStarted === 0 && stats.watchlistSize === 0;

  if (isEmpty) {
    return (
      <div className="page">
        <ProfileHead />
        <div className="empty-panel">
          <h3>Your list is empty</h3>
          <p>
            Start an episode or save a title and it shows up here — no account needed. Everything stays
            in this browser.
          </p>
          <Link className="button-primary" href="/discover">Find something to watch</Link>
        </div>
      </div>
    );
  }

  const rows = tab === 'watching' ? library.continueRow : library.watchlist;

  return (
    <div className="page">
      <ProfileHead />

      <dl className="stat-grid">
        <Stat label="Watch time" value={formatWatchTime(stats.minutesWatched)} />
        <Stat label="Episodes" value={String(stats.episodesCompleted)} />
        <Stat label="Titles started" value={String(stats.titlesStarted)} />
        <Stat label="Completed" value={String(stats.titlesCompleted)} />
      </dl>

      {stats.topGenres.length > 0 ? (
        <section className="taste-panel">
          <h3>What you watch</h3>
          <ul className="taste-list">
            {stats.topGenres.map((genre) => (
              <li key={genre.name}>
                <span className="taste-name">{genre.name}</span>
                <span
                  className="taste-bar"
                  // Relative to the top genre, so the bars always use the
                  // full width regardless of absolute counts.
                  style={{ ['--fill' as string]: `${(genre.count / stats.topGenres[0].count) * 100}%` }}
                  aria-hidden="true"
                />
                <span className="taste-count">{genre.count}</span>
              </li>
            ))}
          </ul>
          {stats.topStudios.length > 0 ? (
            <p className="taste-foot">
              Most-watched studio{stats.topStudios.length > 1 ? 's' : ''}:{' '}
              {stats.topStudios.map((studio) => studio.name).join(', ')}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="chip-row" role="tablist" aria-label="List">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'watching'}
          className={tab === 'watching' ? 'chip is-active' : 'chip'}
          onClick={() => setTab('watching')}
        >
          Continue watching ({library.continueRow.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'list'}
          className={tab === 'list' ? 'chip is-active' : 'chip'}
          onClick={() => setTab('list')}
        >
          Saved ({library.watchlist.length})
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="empty-state">
          {tab === 'watching' ? 'Nothing in progress right now.' : 'Nothing saved yet.'}
        </p>
      ) : (
        <ul className="library-list">
          {rows.map((entry) => {
            const ratio = 'progressRatio' in entry ? entry.progressRatio : 0;
            const episodeNumber = 'episodeNumber' in entry ? entry.episodeNumber : null;

            return (
              <li key={entry.mediaId} className="library-row">
                <button type="button" onClick={() => setSelected(stubSummaryFor(entry))}>
                  {entry.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.coverImage} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="schedule-cover-blank" aria-hidden="true" />
                  )}
                  <span className="library-copy">
                    <span className="library-title">{entry.title}</span>
                    {episodeNumber !== null ? (
                      <>
                        <span className="library-meta">Episode {episodeNumber}</span>
                        <span className="progress-track" aria-hidden="true">
                          <span
                            className="progress-fill"
                            style={{ width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }}
                          />
                        </span>
                      </>
                    ) : (
                      <span className="library-meta">Saved for later</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="library-remove"
                  onClick={() => library.forget(entry.mediaId)}
                  aria-label={`Remove ${entry.title}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <TitleDialog key={selected.id} summary={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function ProfileHead() {
  return (
    <header className="page-head">
      <p className="eyebrow">Stored in this browser</p>
      <h2 className="page-title">My list</h2>
      <p className="page-lede">
        Progress, saved titles and viewing habits — all local, no account required.
      </p>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
