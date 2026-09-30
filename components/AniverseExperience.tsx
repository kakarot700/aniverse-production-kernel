'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogCard } from '@/components/CatalogCard';
import { ContinueShelf, WatchlistShelf } from '@/components/LibraryShelf';
import { TitleDialog } from '@/components/TitleDialog';
import { useCatalog, useDebouncedValue } from '@/hooks/useAnimeData';
import { useLibrary } from '@/hooks/useLibrary';
import { describeRuntime, formatLabel } from '@/lib/anime/text';
import {
  ANIME_FORMATS,
  ANIME_GENRES,
  ANIME_SEASONS,
  type AnimeSummary,
  type CatalogMode,
  type CatalogPage,
} from '@/types/anime';

interface AniverseExperienceProps {
  initialPage: CatalogPage | null;
  currentSeason: { season: string; year: number };
}

const MODE_TABS: Array<{ id: CatalogMode; label: string }> = [
  { id: 'trending', label: 'Trending now' },
  { id: 'popular', label: 'All-time popular' },
  { id: 'top', label: 'Top rated' },
  { id: 'seasonal', label: 'This season' },
  { id: 'upcoming', label: 'Upcoming' },
];

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENT_YEAR = new Date().getUTCFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR + 1 - 1960 + 1 }, (_, index) => CURRENT_YEAR + 1 - index);

export function AniverseExperience({ initialPage, currentSeason }: AniverseExperienceProps) {
  const [mode, setMode] = useState<CatalogMode>('trending');
  const [searchInput, setSearchInput] = useState('');
  const [genre, setGenre] = useState('');
  const [format, setFormat] = useState('');
  const [season, setSeason] = useState('');
  const [year, setYear] = useState<number | null>(null);
  const [selected, setSelected] = useState<AnimeSummary | null>(null);
  const roomHandledRef = useRef(false);

  const library = useLibrary();
  const search = useDebouncedValue(searchInput.trim(), 350);
  const effectiveMode: CatalogMode = search ? 'search' : mode;
  const isPristine =
    effectiveMode === 'trending' && !search && !genre && !format && !season && year === null;

  const catalog = useCatalog({
    mode: effectiveMode,
    search,
    genre,
    format,
    season,
    year,
    perPage: 24,
    initialPage: isPristine ? initialPage : null,
  });

  const featured = useMemo(
    () => initialPage?.items[0] ?? catalog.items[0] ?? null,
    [catalog.items, initialPage],
  );

  // A `?room=<uuid>` deep link should open a player so the invitee lands in the
  // same dialog as the host.
  useEffect(() => {
    if (roomHandledRef.current || !featured) return;
    const roomId = new URL(window.location.href).searchParams.get('room') ?? '';
    if (ROOM_ID_PATTERN.test(roomId)) {
      roomHandledRef.current = true;
      setSelected(featured);
    }
  }, [featured]);

  const resetFilters = () => {
    setSearchInput('');
    setGenre('');
    setFormat('');
    setSeason('');
    setYear(null);
    setMode('trending');
  };

  const hasFilters = Boolean(search || genre || format || season || year !== null);
  const resultLabel = catalog.loading && catalog.items.length === 0
    ? 'Loading the catalog…'
    : search
      ? `${catalog.total.toLocaleString()} result${catalog.total === 1 ? '' : 's'} for “${search}”`
      : `${catalog.total.toLocaleString()} title${catalog.total === 1 ? '' : 's'}`;

  return (
    <div className="site-shell">
      <div className="mesh-backdrop" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Aniverse home">
          <span className="brand-mark" aria-hidden="true">a</span>
          <span>ANIVERSE</span>
        </a>
        <nav className="header-nav" aria-label="Main navigation">
          <a href="#collection">Discover</a>
          <a href="#about">About</a>
          <a href="/servers">Servers</a>
          <button type="button" onClick={() => featured && setSelected(featured)}>Watch together</button>
        </nav>
        <span className="header-note">
          {currentSeason.season.charAt(0) + currentSeason.season.slice(1).toLowerCase()} {currentSeason.year}
        </span>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Every anime, one calm place</p>
            <h1 id="hero-title">Find your next little world.</h1>
            <p>
              Search the complete anime database — every series, film, OVA and ONA — then play it through whichever
              stream server answers fastest, together with a friend if you like.
            </p>
            <a className="button-primary" href="#collection">
              Explore the collection <span aria-hidden="true">↘</span>
            </a>
          </div>
          {featured ? (
            <button
              className="hero-art"
              type="button"
              onClick={() => setSelected(featured)}
              aria-label={`Explore featured story ${featured.title}`}
            >
              <img
                src={featured.bannerImage || featured.coverImage}
                alt=""
                fetchPriority="high"
                referrerPolicy="no-referrer"
              />
              <span className="featured-seal">Trending now</span>
              <span className="hero-art-copy">
                <span>Featured{featured.year ? ` · ${featured.year}` : ''}</span>
                <strong>{featured.title}</strong>
                <small>
                  {featured.genres.slice(0, 2).join(' · ') || formatLabel(featured.format)} · {describeRuntime(featured)}
                </small>
              </span>
            </button>
          ) : (
            <div className="hero-art hero-art-skeleton" aria-hidden="true" />
          )}
        </section>

        {/* Personal rows sit above the catalog, but only on the unfiltered
            view — they are noise in the middle of a search. */}
        {!search ? (
          <>
            <ContinueShelf items={library.continueRow} onOpen={setSelected} onForget={library.forget} />
            <WatchlistShelf items={library.watchlist} onOpen={setSelected} />
          </>
        ) : null}

        <section id="collection" className="collection" aria-labelledby="collection-title">
          <div className="collection-head">
            <div>
              <p className="eyebrow">The collection</p>
              <h2 id="collection-title">Browse the whole catalog</h2>
              <p className="collection-caption">{resultLabel}</p>
            </div>
            <label className="search-wrap">
              <span className="search-mark" aria-hidden="true" />
              <span className="sr-only">Search anime</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search any anime…"
                maxLength={100}
              />
            </label>
          </div>

          <div className="mode-row" role="group" aria-label="Catalog view">
            {MODE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="mode-button"
                aria-pressed={!search && mode === tab.id}
                disabled={Boolean(search)}
                onClick={() => setMode(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

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
              {Array.from({ length: 12 }, (_, index) => (
                <div className="card-skeleton" key={index} />
              ))}
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
                  <button type="button" className="button-quiet" onClick={catalog.loadMore} disabled={catalog.loadingMore}>
                    {catalog.loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                ) : (
                  <p className="load-more-end">That is every match for these filters.</p>
                )}
              </div>
            </>
          ) : !catalog.error ? (
            <p className="empty-state" role="status">
              No titles match these filters. Try a different search, genre or year.
            </p>
          ) : null}
        </section>

        <section id="about" className="collection" aria-labelledby="about-title">
          <p className="eyebrow">A note on this build</p>
          <h2 id="about-title">Real catalog, real servers, honest edges.</h2>
          <p className="collection-caption">
            Titles, artwork, episode lists and official streaming links come from AniList with a MyAnimeList (Jikan)
            mirror behind it. Playback runs through the stream-server registry: every server is probed, ranked and
            failed over automatically, and each one is configured by the operator from sources they are licensed to
            serve. The bundled reference servers are public test streams so playback, failover and watch-room sync are
            verifiable before you plug in your own.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span>© Aniverse · Stories in motion</span>
          <span>Catalog data by AniList &amp; MyAnimeList. Made for the in-between moments.</span>
        </div>
      </footer>

      {selected ? <TitleDialog key={selected.id} summary={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
