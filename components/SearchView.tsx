'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CatalogBrowser } from '@/components/CatalogBrowser';
import { useDebouncedValue } from '@/hooks/useAnimeData';

/**
 * The full search results page.
 *
 * The URL is the source of truth for the query, so results are shareable and
 * the back button steps through searches. Typing updates local state
 * immediately (the input must never lag) and the URL only once the debounce
 * settles, which keeps history entries meaningful instead of one per
 * keystroke.
 */
export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const openId = params.get('open');

  const [term, setTerm] = useState(urlQuery);
  const debounced = useDebouncedValue(term.trim(), 350);

  // Back/forward navigation changes the URL without touching local state.
  useEffect(() => {
    setTerm(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (debounced === urlQuery.trim()) return;
    const next = debounced ? `/search?q=${encodeURIComponent(debounced)}` : '/search';
    // `replace`, not `push`: refining a query is one intent, not many, and
    // pushing would make the back button walk letter by letter.
    router.replace(next, { scroll: false });
  }, [debounced, router, urlQuery]);

  const active = debounced.length >= 2;

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Search</p>
        <h2 className="page-title">
          {urlQuery ? <>Results for “{urlQuery}”</> : 'Find anything'}
        </h2>
      </header>

      <label className="search-wrap search-wrap-page">
        <span className="sr-only">Search anime</span>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search any anime…"
          maxLength={100}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={!urlQuery}
        />
      </label>

      {active ? (
        <CatalogBrowser
          key={debounced}
          mode="search"
          search={debounced}
          autoOpenId={openId}
          emptyMessage={`Nothing matched “${debounced}”. Check the spelling, or try the romaji title.`}
        />
      ) : (
        <p className="empty-state">Type at least two characters to search.</p>
      )}
    </div>
  );
}
