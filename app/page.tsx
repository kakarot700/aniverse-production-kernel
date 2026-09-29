import { AniverseExperience } from '@/components/AniverseExperience';
import { currentAnimeSeason, getCatalogPage, normalizeCatalogQuery } from '@/lib/anime';
import type { CatalogPage } from '@/types/anime';

// The catalog is live data; render on request and let the in-process TTL cache
// absorb repeat traffic.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const query = normalizeCatalogQuery({ mode: 'trending', page: 1, perPage: 24 });

  let initialPage: CatalogPage | null = null;
  try {
    const result = await getCatalogPage(query);
    const page: CatalogPage = {
      items: result.items,
      pageInfo: result.pageInfo,
      source: result.source,
      degraded: result.degraded,
      notice: result.notice,
    };
    // A degraded first paint is not worth shipping to the client: the browser
    // can usually reach AniList even when this server cannot.
    initialPage = page.degraded ? null : page;
  } catch {
    initialPage = null;
  }

  return <AniverseExperience initialPage={initialPage} currentSeason={currentAnimeSeason()} />;
}
