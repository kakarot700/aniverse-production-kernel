'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogCard } from '@/components/CatalogCard';

/**
 * The player dialog pulls in hls.js (~130 kB) and the whole watch-room stack.
 * Nobody needs that to look at the grid, so it is split out and only fetched
 * when a title is actually opened.
 */
const TitleDialog = dynamic(() => import('@/components/TitleDialog').then((mod) => mod.TitleDialog), {
  ssr: false,
});
import { useCatalog, useDebounced, type CatalogFilters } from '@/hooks/useCatalog';
import type { CatalogPage, MediaCatalogRecord } from '@/types/media';

interface AniverseExperienceProps {
  initial: CatalogPage;
  genres: string[];
}

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const SOURCE_LABEL: Record<string, string> = {
  anilist: 'AniList',
  jikan: 'MyAnimeList (Jikan)',
  offline: 'bundled offline catalog',
};

export function AniverseExperience({ initial, genres }: AniverseExperienceProps) {
  const [searchInput, setSearchInput] = useState('');
  const [genre, setGenre] = useState('All');
  const [sort, setSort] = useState<string>('trending');
  const [format, setFormat] = useState('');
  const [selected, setSelected] = useState<MediaCatalogRecord | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const search = useDebounced(searchInput, 350);

  const filters = useMemo<CatalogFilters>(
    () => ({ search, genre, sort, year: null, format }),
    [search, genre, sort, format],
  );

  // Only reuse the server-rendered page while the user is on the default view.
  const isDefaultView = search === '' && genre === 'All' && sort === 'trending' && format === '';
  const catalog = useCatalog(filters, isDefaultView ? initial : undefined);

  const featured = catalog.items[0];
  const genreChips = useMemo(() => ['All', ...genres], [genres]);

  // Deep link: /?room=<uuid> opens the featured title so both peers land in
  // the same player.
  const roomHandledRef = useRef(false);
  useEffect(() => {
    if (roomHandledRef.current || !featured) return;
    const roomId = new URL(window.location.href).searchParams.get('room') ?? '';
    if (ROOM_ID_PATTERN.test(roomId)) {
      roomHandledRef.current = true;
      setSelected(featured);
    }
  }, [featured]);

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

  const openWatchRoom = () => {
    if (featured) setSelected(featured);
  };

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
          <button type="button" onClick={openWatchRoom}>
            Watch together
          </button>
        </nav>
        <span className="header-note">
          {catalog.total > 0 ? `${catalog.total.toLocaleString()} titles` : 'Every anime, one shelf'}
        </span>
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
              onClick={() => setSelected(featured)}
              aria-label={`Open featured title ${featured.title}`}
            >
              <img src={featured.bannerImage || featured.coverPoster} alt="" fetchPriority="high" />
              <span className="featured-seal">Trending now</span>
              <span className="hero-art-copy">
                <span>
                  Featured{featured.year ? ` · ${featured.year}` : ''}
                </span>
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
                  <CatalogCard key={`${item.id}-${index}`} item={item} onSelect={setSelected} />
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

      {selected ? <TitleDialog item={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
