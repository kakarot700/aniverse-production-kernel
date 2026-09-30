'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogCard } from '@/components/CatalogCard';
import { ContinueShelf, RecommendationShelf, WatchlistShelf } from '@/components/LibraryShelf';
import { TitleDialog } from '@/components/TitleDialog';
import { useCatalog } from '@/hooks/useAnimeData';
import { useLibrary } from '@/hooks/useLibrary';
import { profileFromLibrary, recommend, topGenres } from '@/lib/recommendations';
import { describeRuntime, formatLabel } from '@/lib/anime/text';
import type { AnimeSummary, CatalogPage } from '@/types/anime';

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HomeViewProps {
  initialPage: CatalogPage | null;
  currentSeason: { season: string; year: number };
}

/**
 * Home.
 *
 * Ordering is the whole design here. Continue Watching sits above everything
 * else — including the hero — the moment it has anything in it, because
 * resuming is overwhelmingly the most common reason someone opens a
 * streaming app. Every study of this pattern says the same thing, and it is
 * a bigger win than any amount of navigation polish.
 *
 * Browsing lives on Discover. Home is for "what was I watching" and "what
 * should I watch", nothing else.
 */
export function HomeView({ initialPage, currentSeason }: HomeViewProps) {
  const [selected, setSelected] = useState<AnimeSummary | null>(null);
  const roomHandledRef = useRef(false);
  const library = useLibrary();

  const catalog = useCatalog({
    mode: 'trending',
    search: '',
    genre: '',
    format: '',
    season: '',
    year: null,
    perPage: 24,
    initialPage,
  });

  const recommendations = useMemo(() => {
    if (!library.state) return { items: [], genres: [] as string[] };
    const profile = profileFromLibrary(library.state);
    if (profile.strength <= 0) return { items: [], genres: [] as string[] };
    return { items: recommend(catalog.items, profile, { limit: 12 }), genres: topGenres(profile) };
  }, [catalog.items, library.state]);

  const featured = useMemo(
    () => initialPage?.items[0] ?? catalog.items[0] ?? null,
    [catalog.items, initialPage],
  );

  // A `?room=<uuid>` deep link opens the player so the invitee lands in the
  // same dialog as the host.
  useEffect(() => {
    if (roomHandledRef.current || !featured) return;
    const roomId = new URL(window.location.href).searchParams.get('room') ?? '';
    if (ROOM_ID_PATTERN.test(roomId)) {
      roomHandledRef.current = true;
      setSelected(featured);
    }
  }, [featured]);

  const hasContinue = library.continueRow.length > 0;
  const seasonLabel = `${currentSeason.season.charAt(0)}${currentSeason.season.slice(1).toLowerCase()} ${currentSeason.year}`;

  return (
    <>
      {/* Resume first, whenever there is something to resume. */}
      {hasContinue ? (
        <ContinueShelf items={library.continueRow} onOpen={setSelected} onForget={library.forget} />
      ) : null}

      <section className={hasContinue ? 'hero hero-compact' : 'hero'} aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Every anime, one calm place</p>
          <h1 id="hero-title">
            {hasContinue ? 'Something new for after.' : 'Find your next little world.'}
          </h1>
          <p>
            Search the complete anime database — every series, film, OVA and ONA — then play it through whichever
            stream server answers fastest, together with a friend if you like.
          </p>
          <div className="hero-actions">
            <Link className="button-primary" href="/discover">
              Explore the collection <span aria-hidden="true">↘</span>
            </Link>
            <Link className="button-quiet" href="/schedule">This week’s schedule</Link>
          </div>
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

      <RecommendationShelf
        items={recommendations.items}
        topGenres={recommendations.genres}
        onOpen={setSelected}
      />
      <WatchlistShelf items={library.watchlist} onOpen={setSelected} />

      <section className="shelf" aria-labelledby="trending-title">
        <div className="shelf-head">
          <div>
            <p className="eyebrow">{seasonLabel}</p>
            <h2 id="trending-title">Trending now</h2>
          </div>
          <Link className="shelf-more" href="/discover">Browse all →</Link>
        </div>

        {catalog.loading && catalog.items.length === 0 ? (
          <div className="rail" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <div className="card-skeleton rail-item" key={index} />)}
          </div>
        ) : (
          // A scroll-snapped rail rather than a grid: it keeps Home to one
          // screen of vertical scroll on a phone while still showing depth.
          <ul className="rail">
            {catalog.items.slice(0, 18).map((item) => (
              <li className="rail-item" key={item.id}>
                <CatalogCard item={item} onSelect={setSelected} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {catalog.degraded ? (
        <p className="degraded-banner" role="status">
          Live anime sources are unreachable from the server, so this is the bundled offline sample. The browser
          retries AniList directly — if you still see this, check network access to <code>graphql.anilist.co</code>.
        </p>
      ) : null}

      {selected ? (
        <TitleDialog key={selected.id} summary={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}
