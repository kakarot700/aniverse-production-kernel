'use client';

import { useMemo, useState } from 'react';
import { CatalogCard } from '@/components/CatalogCard';
import { TitleDialog } from '@/components/TitleDialog';
import { useCatalog } from '@/hooks/useAnimeData';
import { formatLabel } from '@/lib/anime/text';
import {
  ANIME_FORMATS,
  ANIME_GENRES,
  ANIME_SEASONS,
  type AnimeSummary,
  type CatalogMode,
  type CatalogPage,
} from '@/types/anime';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR + 2 - 1960 }, (_, index) => CURRENT_YEAR + 1 - index);

export interface CatalogBrowserProps {
  mode: CatalogMode;
  search?: string;
  /** Mode tabs are meaningless on a search results page. */
  modes?: Array<{ id: CatalogMode; label: string }>;
  onModeChange?: (mode: CatalogMode) => void;
  initialPage?: CatalogPage | null;
  /** Opens this title's dialog on mount — used by `?open=` deep links. */
  autoOpenId?: string | null;
  emptyMessage?: string;
}

/**
 * Filters plus a results grid.
 *
 * Extracted so Discover and Search share one implementation: they differ only
 * in which mode they start from and whether the mode tabs are shown, and
 * duplicating several hundred lines for that would guarantee they drift.
 */
export function CatalogBrowser({
  mode,
  search = '',
  modes,
  onModeChange,
  initialPage = null,
  autoOpenId = null,
  emptyMessage = 'No titles match these filters. Try a different search, genre or year.',
}: CatalogBrowserProps) {
  const [genre, setGenre] = useState('');
  const [format, setFormat] = useState('');
  const [season, setSeason] = useState('');
  const [year, setYear] = useState<number | null>(null);
  const [selected, setSelected] = useState<AnimeSummary | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);

  const hasFilters = Boolean(genre || format || season || year !== null);

  const catalog = useCatalog({
    mode,
    search,
    genre,
    format,
    season,
    year,
    perPage: 24,
    initialPage: hasFilters ? null : initialPage,
  });

  // Deep-linked title. Done during render rather than in an effect so the
  // dialog is present on the first paint that has the data, avoiding a
  // visible flash of the grid before it opens.
  if (autoOpenId && !autoOpened && catalog.items.length > 0) {
    const match = catalog.items.find((item) => item.id === autoOpenId);
    if (match) {
      setSelected(match);
      setAutoOpened(true);
    } else if (!catalog.loading) {
      setAutoOpened(true);
    }
  }

  const resultLabel = useMemo(() => {
    if (catalog.loading && catalog.items.length === 0) return 'Loading…';
    const total = catalog.total.toLocaleString();
    if (search) return `${total} result${catalog.total === 1 ? '' : 's'} for “${search}”`;
    return `${total} title${catalog.total === 1 ? '' : 's'}`;
  }, [catalog.items.length, catalog.loading, catalog.total, search]);

  const resetFilters = () => {
    setGenre('');
    setFormat('');
    setSeason('');
    setYear(null);
  };

  return (
    <>
      {modes && modes.length > 0 ? (
        <div className="chip-row" role="group" aria-label="Catalog view">
          {modes.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={mode === tab.id ? 'chip is-active' : 'chip'}
              aria-pressed={mode === tab.id}
              onClick={() => onModeChange?.(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="filter-row">
        <label className="filter-field">
          <span>Genre</span>
          <select value={genre} onChange={(event) => setGenre(event.target.value)}>
            <option value="">Any genre</option>
            {ANIME_GENRES.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value)}>
            <option value="">Any format</option>
            {ANIME_FORMATS.map((entry) => (
              <option key={entry} value={entry}>{formatLabel(entry)}</option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Season</span>
          <select value={season} onChange={(event) => setSeason(event.target.value)}>
            <option value="">Any season</option>
            {ANIME_SEASONS.map((entry) => (
              <option key={entry} value={entry}>{entry.charAt(0) + entry.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Year</span>
          <select
            value={year ?? ''}
            onChange={(event) => setYear(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Any year</option>
            {YEARS.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
        </label>
        {hasFilters ? (
          <button type="button" className="button-quiet filter-reset" onClick={resetFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      <p className="result-count" role="status">{resultLabel}</p>

      {catalog.degraded ? (
        <p className="degraded-banner" role="status">
          Live anime sources are unreachable from the server, so this is the bundled offline sample. The browser
          retries AniList directly — if you still see this, check network access to <code>graphql.anilist.co</code>.
        </p>
      ) : null}

      {catalog.error && catalog.items.length === 0 ? (
        <p className="empty-state" role="status">
          {catalog.error}{' '}
          <button type="button" className="link-button" onClick={catalog.reload}>Try again</button>
        </p>
      ) : null}

      {catalog.loading && catalog.items.length === 0 ? (
        <div className="catalog-grid" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => <div className="card-skeleton" key={index} />)}
        </div>
      ) : catalog.items.length > 0 ? (
        <>
          <div className="catalog-grid">
            {catalog.items.map((item) => (
              <CatalogCard key={item.id} item={item} onSelect={setSelected} />
            ))}
          </div>
          <div className="load-more-row">
            {catalog.hasNextPage ? (
              <button
                type="button"
                className="button-quiet"
                onClick={catalog.loadMore}
                disabled={catalog.loadingMore}
              >
                {catalog.loadingMore ? 'Loading…' : 'Load more'}
              </button>
            ) : (
              <p className="load-more-end">That is every match for these filters.</p>
            )}
          </div>
        </>
      ) : !catalog.error ? (
        <p className="empty-state" role="status">{emptyMessage}</p>
      ) : null}

      {selected ? (
        <TitleDialog key={selected.id} summary={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}
