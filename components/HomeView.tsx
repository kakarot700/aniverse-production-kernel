'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CatalogRail } from '@/components/CatalogRail';
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
 * Shaped as a stack of shelves rather than one grid, because the job of this
 * page is to offer a shortlist from several angles, not to be a catalog —
 * that is what Discover is for.
 *
 * Ordering is the actual design. Continue Watching sits above everything
 * including the hero the moment it has anything in it, because resuming is
 * overwhelmingly the most common reason anyone opens a streaming app. Every
 * study of the pattern agrees, and it outweighs any amount of nav polish.
 */
export function HomeView({ initialPage, currentSeason }: HomeViewProps) {
  const [selected, setSelected] = useState<AnimeSummary | null>(null);
  const roomHandledRef = useRef(false);
  const library = useLibrary();

  // The hero and the first rail share this one request; the remaining rails
  // fetch their own so the page streams in rather than blocking.
  const trending = useCatalog({
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
    return { items: recommend(trending.items, profile, { limit: 12 }), genres: topGenres(profile) };
  }, [trending.items, library.state]);

  const featured = useMemo(
    () => initialPage?.items[0] ?? trending.items[0] ?? null,
    [trending.items, initialPage],
  );

  // A `?room=<uuid>` deep link opens the player so an invitee lands in the
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
    <div className="home">
      {/* Cinematic hero. Full-bleed artwork with the copy laid over it —
          the previous split of text beside a small card gave the artwork no
          room to do its job, which on a catalog page is most of the job. */}
      <section className="hero-cinema" aria-labelledby="hero-title">
        {featured ? (
          <>
            <div className="hero-cinema-art" aria-hidden="true">
              <img
                src={featured.bannerImage || featured.coverImage}
                alt=""
                fetchPriority="high"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="hero-cinema-copy">
              <p className="eyebrow">Featured · {seasonLabel}</p>
              <h1 id="hero-title">{featured.title}</h1>
              <p className="hero-cinema-meta">
                {[
                  featured.genres.slice(0, 3).join(' · ') || formatLabel(featured.format),
                  describeRuntime(featured),
                  featured.averageScore ? `${featured.averageScore}% rated` : null,
                ]
                  .filter(Boolean)
                  .join('  •  ')}
              </p>
              {featured.synopsis ? (
                <p className="hero-cinema-synopsis">{featured.synopsis}</p>
              ) : null}
              <div className="hero-actions">
                <button type="button" className="button-primary" onClick={() => setSelected(featured)}>
                  ▶ Watch now
                </button>
                <Link className="button-quiet" href="/discover">Browse catalog</Link>
              </div>
            </div>
          </>
        ) : (
          <div className="hero-cinema-skeleton" aria-hidden="true">
            <h1 id="hero-title" className="sr-only">Aniverse</h1>
          </div>
        )}
      </section>

      {/* Resume first, whenever there is something to resume. */}
      {hasContinue ? (
        <ContinueShelf items={library.continueRow} onOpen={setSelected} onForget={library.forget} />
      ) : null}

      <RecommendationShelf
        items={recommendations.items}
        topGenres={recommendations.genres}
        onOpen={setSelected}
      />

      {/* The first rail reuses the hero's request; the rest fetch their own. */}
      <CatalogRail
        mode="trending"
        title="Trending now"
        eyebrow="What everyone is watching"
        href="/discover"
        initialPage={initialPage}
        onSelect={setSelected}
      />

      <WatchlistShelf items={library.watchlist} onOpen={setSelected} />

      <CatalogRail
        mode="seasonal"
        title={`${seasonLabel} anime`}
        eyebrow="Airing this season"
        href="/schedule"
        onSelect={setSelected}
      />

      <CatalogRail
        mode="top"
        title="Highest rated of all time"
        eyebrow="The canon"
        href="/discover"
        onSelect={setSelected}
      />

      <CatalogRail
        mode="popular"
        title="Most popular"
        eyebrow="Never a wrong answer"
        href="/discover"
        onSelect={setSelected}
      />

      <CatalogRail
        mode="upcoming"
        title="Coming soon"
        eyebrow="Next season"
        href="/discover"
        onSelect={setSelected}
      />

      {trending.degraded ? (
        <p className="degraded-banner" role="status">
          Live anime sources are unreachable from the server, so this is the bundled offline sample. The browser
          retries AniList directly — if you still see this, check network access to <code>graphql.anilist.co</code>.
        </p>
      ) : null}

      {selected ? (
        <TitleDialog key={selected.id} summary={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
