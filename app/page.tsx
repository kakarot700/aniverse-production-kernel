import { AniverseExperience } from '@/components/AniverseExperience';
import { browseCatalog, listGenres, parseCatalogQuery } from '@/lib/anime';

// The catalog is provider-backed and revalidates on a short window rather
// than being frozen into the build output.
export const revalidate = 60;

export default async function HomePage() {
  const query = parseCatalogQuery(new URLSearchParams({ sort: 'trending', perPage: '24', page: '1' }));

  // Called in-process: no self-referential HTTP request, which would need an
  // absolute origin and would deadlock a single-worker dev server.
  const [initial, genreResult] = await Promise.all([
    browseCatalog(query),
    listGenres(),
  ]);

  return <AniverseExperience initial={initial} genres={genreResult.genres} />;
}
