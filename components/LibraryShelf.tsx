'use client';

import type { ContinueWatchingItem, WatchlistEntry } from '@/lib/user-data/library';
import type { AnimeSummary } from '@/types/anime';

const FALLBACK_POSTER = '/posters/aurora.jpg';

/**
 * The library stores only what it needs to draw a row: id, title, artwork.
 * Opening one rehydrates the full record from the catalog by id, so this stub
 * just has to be a valid `AnimeSummary` for the dialog to start from.
 */
export function stubSummaryFor(entry: { mediaId: string; title: string; coverImage: string }): AnimeSummary {
  const anilistMatch = entry.mediaId.match(/^anilist:(\d+)$/);
  return {
    id: entry.mediaId,
    anilistId: anilistMatch ? Number(anilistMatch[1]) : null,
    malId: null,
    slug: entry.mediaId,
    title: entry.title,
    titles: { romaji: entry.title, english: null, native: null },
    synopsis: '',
    coverImage: entry.coverImage || FALLBACK_POSTER,
    bannerImage: null,
    accentColor: null,
    genres: [],
    year: null,
    season: null,
    format: 'TV',
    status: 'FINISHED',
    episodeCount: null,
    durationMinutes: null,
    averageScore: null,
    popularity: null,
    studios: [],
    isAdult: false,
    trailer: null,
    source: 'offline',
  };
}

interface ContinueShelfProps {
  items: ContinueWatchingItem[];
  onOpen: (summary: AnimeSummary) => void;
  onForget: (mediaId: string) => void;
}

export function ContinueShelf({ items, onOpen, onForget }: ContinueShelfProps) {
  if (items.length === 0) return null;

  return (
    <section className="shelf" aria-labelledby="continue-title">
      <div className="shelf-head">
        <div>
          <p className="eyebrow">Pick up where you left off</p>
          <h2 id="continue-title">Continue watching</h2>
        </div>
      </div>
      <ul className="shelf-row">
        {items.map((item) => (
          <li className="shelf-item" key={item.mediaId}>
            <button
              type="button"
              className="shelf-card"
              onClick={() => onOpen(stubSummaryFor(item))}
              aria-label={`Resume ${item.title}, episode ${item.episodeNumber}`}
            >
              <span className="shelf-art">
                <img src={item.coverImage || FALLBACK_POSTER} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <span className="shelf-play" aria-hidden="true">▶</span>
                {item.progressRatio > 0 ? (
                  <span className="shelf-progress" aria-hidden="true">
                    <span style={{ width: `${Math.round(item.progressRatio * 100)}%` }} />
                  </span>
                ) : null}
              </span>
              <span className="shelf-title" title={item.title}>{item.title}</span>
              <span className="shelf-sub">
                {item.resumeMs > 0 ? `Resume episode ${item.episodeNumber}` : `Next: episode ${item.episodeNumber}`}
              </span>
            </button>
            <button
              type="button"
              className="shelf-dismiss"
              onClick={() => onForget(item.mediaId)}
              aria-label={`Remove ${item.title} from continue watching`}
              title="Remove from continue watching"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface WatchlistShelfProps {
  items: WatchlistEntry[];
  onOpen: (summary: AnimeSummary) => void;
}

export function WatchlistShelf({ items, onOpen }: WatchlistShelfProps) {
  if (items.length === 0) return null;

  return (
    <section className="shelf" aria-labelledby="watchlist-title">
      <div className="shelf-head">
        <div>
          <p className="eyebrow">Saved for later</p>
          <h2 id="watchlist-title">Your list</h2>
        </div>
        <span className="shelf-count">{items.length} saved</span>
      </div>
      <ul className="shelf-row">
        {items.map((item) => (
          <li className="shelf-item" key={item.mediaId}>
            <button
              type="button"
              className="shelf-card"
              onClick={() => onOpen(stubSummaryFor(item))}
              aria-label={`Open ${item.title}`}
            >
              <span className="shelf-art">
                <img src={item.coverImage || FALLBACK_POSTER} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <span className="shelf-play" aria-hidden="true">▶</span>
              </span>
              <span className="shelf-title" title={item.title}>{item.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
