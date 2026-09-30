'use client';

import Link from 'next/link';
import { CatalogCard } from '@/components/CatalogCard';
import { useCatalog } from '@/hooks/useAnimeData';
import type { AnimeSummary, CatalogMode, CatalogPage } from '@/types/anime';

interface CatalogRailProps {
  mode: CatalogMode;
  title: string;
  eyebrow?: string;
  /** Deep link for the "see all" affordance. */
  href?: string;
  genre?: string;
  limit?: number;
  initialPage?: CatalogPage | null;
  onSelect: (item: AnimeSummary) => void;
}

/**
 * One horizontally-scrolling shelf, fetching its own slice of the catalog.
 *
 * Each rail owning its request is the point: a home page of six shelves
 * paints as each one arrives instead of blocking on the slowest, and a
 * single failing mode costs one row rather than the page. It also means
 * every rail independently inherits the direct-to-AniList fallback in
 * `useCatalog`, so a sandboxed or offline app server still fills the page
 * from the viewer's own connection.
 */
export function CatalogRail({
  mode,
  title,
  eyebrow,
  href,
  genre = '',
  limit = 18,
  initialPage = null,
  onSelect,
}: CatalogRailProps) {
  const catalog = useCatalog({
    mode,
    search: '',
    genre,
    format: '',
    season: '',
    year: null,
    perPage: limit,
    initialPage,
  });

  const items = catalog.items.slice(0, limit);

  // A rail that failed and has nothing to show is removed rather than left
  // as an empty frame. An apology where content should be is worse than the
  // row simply not being there.
  if (!catalog.loading && items.length === 0) return null;

  return (
    <section className="shelf" aria-labelledby={`shelf-${mode}-${genre || 'all'}`}>
      <div className="shelf-head">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 id={`shelf-${mode}-${genre || 'all'}`}>{title}</h2>
        </div>
        {href ? <Link className="shelf-more" href={href}>See all →</Link> : null}
      </div>

      {catalog.loading && items.length === 0 ? (
        <div className="rail" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="card-skeleton rail-item" key={index} />
          ))}
        </div>
      ) : (
        <ul className="rail">
          {items.map((item) => (
            <li className="rail-item" key={item.id}>
              <CatalogCard item={item} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
