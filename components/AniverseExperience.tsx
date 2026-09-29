'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountPanel } from '@/components/AccountPanel';
import { CatalogCard } from '@/components/CatalogCard';
import { CatalogShelf } from '@/components/CatalogShelf';
import { useCatalog, useDebounced, type CatalogFilters } from '@/hooks/useCatalog';
import { useSupabaseUser } from '@/hooks/useSupabaseUser';
import { useUserLibrary } from '@/hooks/useUserLibrary';
import type { CatalogPage, MediaCatalogRecord } from '@/types/media';

/**
 * The player dialog pulls in hls.js (~130 kB) and the whole watch-room stack.
 * Nobody needs that to look at the grid, so it is split out and only fetched
 * when a title is actually opened.
 */
const TitleDialog = dynamic(() => import('@/components/TitleDialog').then((mod) => mod.TitleDialog), {
  ssr: false,
});

interface AniverseExperienceProps {
  initial: CatalogPage;
  genres: string[];
}

const CATALOG_ID_PATTERN = /^(anilist|mal|offline):[A-Za-z0-9._-]{1,80}$/;

const SORT_OPTIONS = [
  { value: 'trending', label: 'Trending' },
  { value: 'popular', label: 'Most popular' },
  { value: 'score', label: 'Highest rated' },
  { value: 'newest', label: 'Newest' },
  { value: 'title', label: 'A–Z' },
] as const;

const FORMAT_OPTIONS = [
  { value: '', label: 'All formats' },
  { value: 'TV', label: 'TV' },
  { value: 'MOVIE', label: 'Film' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'SPECIAL', label: 'Special' },
] as const;

const SEASON_OPTIONS = [
  { value: '', label: 'Any season' },
  { value: 'WINTER', label: 'Winter' },
  { value: 'SPRING', label: 'Spring' },
  { value: 'SUMMER', label: 'Summer' },
  { value: 'FALL', label: 'Fall' },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  anilist: 'AniList',
  jikan: 'MyAnimeList (Jikan)',
  offline: 'bundled offline catalog',
};

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 46 }, (_unused, index) => CURRENT_YEAR + 1 - index);

interface OpenTitle {
  id: string;
  preview: MediaCatalogRecord | null;
  episode: number;
}

/** Reads `?title=` / `?ep=` so an invite link resolves to a specific title. */
function readTitleFromUrl(): { id: string; episode: number } | null {
  if (typeof window === 'undefined') return null;
  const params = new URL(window.location.href).searchParams;
  const id = params.get('title') ?? '';
  if (!CATALOG_ID_PATTERN.test(id)) return null;
  const episode = Number.parseInt(params.get('ep') ?? '1', 10);
  return { id, episode: Number.isSafeInteger(episode) && episode > 0 ? episode : 1 };
}

function writeTitleToUrl(id: string | null, episode: number): void {
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set('title', id);
    url.searchParams.set('ep', String(episode));
  } else {
    url.searchParams.delete('title');
    url.searchParams.delete('ep');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function AniverseExperience({ initial, genres }: AniverseExperienceProps) {
  const [searchInput, setSearchInput] = useState('');
  const [genre, setGenre] = useState('All');
  const [sort, setSort] = useState<string>('trending');
  const [format, setFormat] = useState('');
  const [season, setSeason] = useState('');
  const [year, setYear] = useState('');
  const [open, setOpen] = useState<OpenTitle | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const account = useSupabaseUser();
  const library = useUserLibrary(account);
  const signedIn = Boolean(account.user);

  const search = useDebounced(searchInput, 350);

  const filters = useMemo<CatalogFilters>(
    () => ({
      search,
      genre,
      sort,
      year: year ? Number.parseInt(year, 10) : null,
      format,
      season,
    }),
    [search, genre, sort, format, season, year],
  );

  const isDefaultView =
    search === '' && genre === 'All' && sort === 'trending' && format === '' && season === '' && year === '';
  const catalog = useCatalog(filters, isDefaultView ? initial : undefined);

  const featured = catalog.items[0];
  const genreChips = useMemo(() => ['All', ...genres], [genres]);

  const openTitle = useCallback((item: MediaCatalogRecord) => {
    setOpen({ id: item.id, preview: item, episode: 1 });
    writeTitleToUrl(item.id, 1);
  }, []);

  const closeTitle = useCallback(() => {
    setOpen(null);
    writeTitleToUrl(null, 1);
  }, []);

  const changeEpisode = useCallback((episodeNumber: number) => {
    setOpen((current) => {
      if (!current) return current;
      writeTitleToUrl(current.id, episodeNumber);
      return { ...current, episode: episodeNumber };
    });
  }, []);

  /**
   * Restore a title from the URL on load.
   *
   * This also fixes the watch-room invite flow: the previous build opened
   * whatever happened to be first in the trending list, so two peers sharing a
   * `?room=` link could easily land on different titles — or the same peer
   * could get a different one an hour later.
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const fromUrl = readTitleFromUrl();
    if (fromUrl) setOpen({ id: fromUrl.id, preview: null, episode: fromUrl.episode });
  }, []);

  // Infinite scroll. Depends on the two values that actually matter, not on
  // the whole catalog object, which is a fresh reference on every render and
  // would tear down and rebuild the observer continuously.
  const { hasNextPage, loadMore } = catalog;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, loadMore]);

  // Most recent episode per title, newest first.
  const continueIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const entry of library.history) {
      if (seen.has(entry.mediaId)) continue;
      seen.add(entry.mediaId);
      ids.push(entry.mediaId);
      if (ids.length >= 12) break;
    }
    return ids;
  }, [library.history]);

  const watchlistIds = useMemo(() => [...library.watchlist].slice(0, 24), [library.watchlist]);

  const continueFootnote = useCallback(
    (item: MediaCatalogRecord) => {
      const entry = library.history.find((candidate) => candidate.mediaId === item.id);
      if (!entry) return null;
      const minutes = Math.floor(entry.positionMs / 60_000);
      const seconds = Math.floor((entry.positionMs % 60_000) / 1000);
      return `Episode ${entry.episodeNumber} · ${minutes}:${String(seconds).padStart(2, '0')}`;
    },
    [library.history],
  );

  return (
    <div className="site-shell">
      <div className="mesh-backdrop" aria-hidden="true" />
      <a className="skip-link" href="#collection">
        Skip to the catalog
      </a>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="Aniverse home">
          <span className="brand-mark" aria-hidden="true">
            a
          </span>
          <span>ANIVERSE</span>
        </a>
        <nav className="header-nav" aria-label="Main navigation">
          <a href="#collection">Discover</a>
          <a href="#about">About</a>
          <button type="button" onClick={() => featured && openTitle(featured)}>
            Watch together
          </button>
        </nav>
        <div className="header-side">
          <span className="header-note">
            {catalog.total > 0 ? `${catalog.total.toLocaleString()} titles` : 'Every anime, one shelf'}
          </span>
          <AccountPanel account={account} savedCount={library.watchlist.size} />
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Powered by {SOURCE_LABEL[catalog.source] ?? catalog.source}</p>
            <h1 id="hero-title">Find your next little world.</h1>
            <p>
              Search the full anime database — every season, every format — then pick a stream server and watch
              together in a synced room.
            </p>
            <a className="button-primary" href="#collection">
              Explore the collection <span aria-hidden="true">↘</span>
            </a>
          </div>
          {featured ? (
            <button
              className="hero-art"
              type="button"
              onClick={() => openTitle(featured)}
              aria-label={`Open featured title ${featured.title}`}
            >
              <img src={featured.bannerImage || featured.coverPoster} alt="" fetchPriority="high" />
              <span className="featured-seal">Trending now</span>
              <span className="hero-art-copy">
                <span>Featured{featured.year ? ` · ${featured.year}` : ''}</span>
                <strong>{featured.title}</strong>
                <small>
                  {featured.genres.slice(0, 3).join(' · ') || featured.genre} · {featured.format}
                </small>
              </span>
            </button>
          ) : (
            <div className="hero-art hero-art-skeleton" aria-hidden="true" />
          )}
        </section>

        {signedIn && continueIds.length > 0 ? (
          <CatalogShelf
            title="Continue watching"
            caption="Picks up where you left off."
            ids={continueIds}
            onSelect={openTitle}
            renderFootnote={continueFootnote}
          />
        ) : null}

        {signedIn && watchlistIds.length > 0 ? (
          <CatalogShelf title="Your list" caption="Saved for later." ids={watchlistIds} onSelect={openTitle} />
        ) : null}

        <section id="collection" className="collection" aria-labelledby="collection-title">
          <div className="collection-head">
            <div>
              <p className="eyebrow">The collection</p>
              <h2 id="collection-title">Made for unhurried evenings</h2>
              <p className="collection-caption">
                {catalog.total > 0
                  ? `${catalog.total.toLocaleString()} matching titles.`
                  : 'Small beginnings, strange horizons, and stories that stay a little longer.'}
              </p>
            </div>
            <label className="search-wrap">
              <span className="search-mark" aria-hidden="true" />
              <span className="sr-only">Search anime</span>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search every anime"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="filter-bar">
            <label className="filter-field">
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span className="sr-only">Filter by format</span>
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                {FORMAT_OPTIONS.map((option) => (
                  <option key={option.value || 'any'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span className="sr-only">Filter by season</span>
              <select value={season} onChange={(event) => setSeason(event.target.value)}>
                {SEASON_OPTIONS.map((option) => (
                  <option key={option.value || 'any'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span className="sr-only">Filter by year</span>
              <select value={year} onChange={(event) => setYear(event.target.value)}>
                <option value="">Any year</option>
                {YEAR_OPTIONS.map((option) => (
                  <option key={option} value={String(option)}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            {!isDefaultView ? (
              <button
                type="button"
                className="filter-reset"
                onClick={() => {
                  setSearchInput('');
                  setGenre('All');
                  setSort('trending');
                  setFormat('');
                  setSeason('');
                  setYear('');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>

          <div className="genre-row" role="group" aria-label="Filter by genre">
            {genreChips.map((entry) => (
              <button
                key={entry}
                type="button"
                className="genre-button"
                aria-pressed={genre === entry}
                onClick={() => setGenre(entry)}
              >
                {entry}
              </button>
            ))}
          </div>

          {catalog.degraded ? (
            <p className="modal-banner" role="status">
              Showing results from the {SOURCE_LABEL[catalog.source] ?? catalog.source}. {catalog.degraded}
            </p>
          ) : null}

          {catalog.error ? (
            <div className="empty-state" role="status">
              <p>{catalog.error}</p>
              <button className="button-quiet" type="button" onClick={catalog.retry}>
                Try again
              </button>
            </div>
          ) : null}

          {catalog.loading && catalog.items.length === 0 ? (
            <div className="catalog-grid" aria-hidden="true">
              {Array.from({ length: 12 }, (_unused, index) => (
                <div key={index} className="card-skeleton" />
              ))}
            </div>
          ) : catalog.items.length ? (
            <>
              <div className="catalog-grid">
                {catalog.items.map((item, index) => (
                  <CatalogCard key={`${item.id}-${index}`} item={item} onSelect={openTitle} />
                ))}
              </div>
              <div ref={sentinelRef} className="grid-sentinel" aria-hidden="true" />
              {catalog.hasNextPage ? (
                <div className="load-more-row">
                  <button
                    className="button-quiet"
                    type="button"
                    onClick={catalog.loadMore}
                    disabled={catalog.loadingMore}
                  >
                    {catalog.loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </>
          ) : !catalog.error ? (
            <p className="empty-state" role="status">
              No titles match that search. Try a different name, genre, or format.
            </p>
          ) : null}
        </section>

        <section id="about" className="collection" aria-labelledby="about-title">
          <p className="eyebrow">A note on this build</p>
          <h2 id="about-title">A real interface, honest about its edges.</h2>
          <p className="collection-caption">
            Metadata comes from AniList with a MyAnimeList (Jikan) fallback and a bundled offline catalog, so the grid
            keeps working during an outage. Playback runs through the server registry: open-tier servers stream
            Creative-Commons reference video out of the box, and third-party servers light up once you supply a source
            map for content you are licensed to distribute. Check <code>/api/servers</code> for the live configuration.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span>© Aniverse · Stories in motion</span>
          <span>Made for the in-between moments.</span>
        </div>
      </footer>

      {open ? (
        <TitleDialog
          key={open.id}
          mediaId={open.id}
          preview={open.preview}
          initialEpisode={open.episode}
          onEpisodeChange={changeEpisode}
          onClose={closeTitle}
          library={library}
          signedIn={signedIn}
        />
      ) : null}
    </div>
  );
}
