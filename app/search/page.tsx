import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SearchView } from '@/components/SearchView';

export const metadata: Metadata = {
  title: 'Search — Aniverse',
  description: 'Search every anime by title.',
};

export default function SearchPage() {
  // `useSearchParams` opts the subtree into client-side bailout, so it has to
  // sit behind a Suspense boundary or the whole route deopts to dynamic.
  return (
    <Suspense fallback={<p className="empty-state">Loading search…</p>}>
      <SearchView />
    </Suspense>
  );
}
