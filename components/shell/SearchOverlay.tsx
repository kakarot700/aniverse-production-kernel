'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDebouncedValue } from '@/hooks/useAnimeData';
import { Icon } from '@/components/shell/NavIcons';
import { addRecentSearch, readRecentSearches, clearRecentSearches } from '@/lib/user-data/recent-searches';
import type { AnimeSummary } from '@/types/anime';

const MAX_RESULTS = 8;

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Command-palette search, reachable from every page.
 *
 * Behaviours that separate a real palette from a text box in a modal:
 *
 *   - Arrow keys move a *virtual* selection; the input never loses focus, so
 *     you can refine the query and change selection without reaching for the
 *     mouse. Managed with aria-activedescendant, which is what that attribute
 *     exists for.
 *   - Enter opens the highlighted result, or runs a full search when nothing
 *     is highlighted. Both are useful and they must not fight.
 *   - The previous results stay on screen while the next query is in flight.
 *     Blanking the list on every keystroke makes a fast connection feel
 *     broken and a slow one feel unusable.
 *   - Focus returns to whatever opened it on close, and Escape always exits.
 */
export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<AnimeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);

  const debounced = useDebouncedValue(term.trim(), 220);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setRecent(readRecentSearches());
    // Defer so the element exists and the browser has painted it.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);

    // The page behind must not scroll while the overlay owns the viewport.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setTerm('');
      setResults([]);
      setHighlight(-1);
    }
  }, [open]);

  useEffect(() => {
    if (!open || debounced.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/catalog?mode=search&q=${encodeURIComponent(debounced)}&perPage=${MAX_RESULTS}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (controller.signal.aborted) return;
        setResults(Array.isArray(payload?.items) ? payload.items.slice(0, MAX_RESULTS) : []);
        setHighlight(-1);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [debounced, open]);

  const runSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      addRecentSearch(trimmed);
      onClose();
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    },
    [onClose, router],
  );

  const openResult = useCallback(
    (item: AnimeSummary) => {
      addRecentSearch(term.trim() || item.title);
      onClose();
      router.push(`/search?q=${encodeURIComponent(item.title)}&open=${encodeURIComponent(item.id)}`);
    },
    [onClose, router, term],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (results.length === 0 ? -1 : (current + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) =>
        results.length === 0 ? -1 : (current - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlight >= 0 && results[highlight]) openResult(results[highlight]);
      else runSearch(term);
      return;
    }
    if (event.key === 'Tab') {
      // A one-element focus trap: there is nothing else to tab to, and
      // letting focus escape to the page behind is disorienting.
      event.preventDefault();
    }
  };

  if (!open) return null;

  const showRecent = term.trim().length < 2 && recent.length > 0;

  return (
    <div
      className="search-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search anime"
        onKeyDown={onKeyDown}
      >
        <div className="search-field">
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            type="search"
            className="search-input"
            placeholder="Search every anime…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {loading ? <span className="search-spinner" aria-hidden="true" /> : null}
          <button type="button" className="search-close" onClick={onClose} aria-label="Close search">
            Esc
          </button>
        </div>

        <div className="search-body">
          {showRecent ? (
            <>
              <div className="search-section-head">
                <span>Recent</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    clearRecentSearches();
                    setRecent([]);
                  }}
                >
                  Clear
                </button>
              </div>
              <ul className="search-recent">
                {recent.map((entry) => (
                  <li key={entry}>
                    <button type="button" className="search-recent-item" onClick={() => runSearch(entry)}>
                      <Icon name="search" size={16} />
                      {entry}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {results.length > 0 ? (
            <ul className="search-results" id={listId} role="listbox" aria-label="Search results">
              {results.map((item, index) => (
                <li
                  key={item.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  className={index === highlight ? 'search-result is-highlight' : 'search-result'}
                >
                  <button type="button" onClick={() => openResult(item)} onMouseEnter={() => setHighlight(index)}>
                    {item.coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.coverImage} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="search-result-blank" aria-hidden="true" />
                    )}
                    <span className="search-result-copy">
                      <span className="search-result-title">{item.title}</span>
                      <span className="search-result-meta">
                        {[item.format, item.year || null, item.episodeCount ? `${item.episodeCount} ep` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {item.averageScore ? <span className="search-result-score">{item.averageScore}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {!loading && term.trim().length >= 2 && results.length === 0 ? (
            <p className="search-empty">No matches for “{term.trim()}”.</p>
          ) : null}

          {term.trim().length >= 2 ? (
            <button type="button" className="search-all" onClick={() => runSearch(term)}>
              See all results for “{term.trim()}”
            </button>
          ) : null}
        </div>

        <footer className="search-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}
