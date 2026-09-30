'use client';

import { useState } from 'react';
import { CatalogBrowser } from '@/components/CatalogBrowser';
import type { CatalogMode } from '@/types/anime';

const MODES: Array<{ id: CatalogMode; label: string }> = [
  { id: 'trending', label: 'Trending' },
  { id: 'popular', label: 'All-time popular' },
  { id: 'top', label: 'Top rated' },
  { id: 'seasonal', label: 'This season' },
  { id: 'upcoming', label: 'Upcoming' },
];

export function DiscoverView() {
  const [mode, setMode] = useState<CatalogMode>('trending');

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">The collection</p>
        <h2 className="page-title">Discover</h2>
        <p className="page-lede">
          Every series, film, OVA and ONA in the AniList database, filtered however you like.
        </p>
      </header>

      <CatalogBrowser mode={mode} modes={MODES} onModeChange={setMode} />
    </div>
  );
}
