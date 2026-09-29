'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogPage, MediaCatalogRecord } from '@/types/media';

export interface CatalogFilters {
  search: string;
  genre: string;
  sort: string;
  year: number | null;
  format: string;
  season: string;
}

export interface CatalogState {
  items: MediaCatalogRecord[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  degraded: string;
  source: string;
  total: number;
  hasNextPage: boolean;
  loadMore: () => void;
  retry: () => void;
}

function buildQuery(filters: CatalogFilters, page: number, perPage: number): string {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage), sort: filters.sort });
  if (filters.search) params.set('q', filters.search);
  if (filters.genre && filters.genre !== 'All') params.set('genre', filters.genre);
  if (filters.year) params.set('year', String(filters.year));
  if (filters.format) params.set('format', filters.format);
  if (filters.season) params.set('season', filters.season);
  return params.toString();
}

/**
 * Paged catalog reader.
 *
 * Filter changes reset to page 1 and *replace* the list; `loadMore` appends.
 * Every request is abortable, and a stale response is discarded by comparing
 * the request token, so fast typing cannot interleave two result sets.
 */
export function useCatalog(
  filters: CatalogFilters,
  initial?: CatalogPage,
  perPage = 24,
): CatalogState {
  const [items, setItems] = useState<MediaCatalogRecord[]>(initial?.items ?? []);
  const [page, setPage] = useState(initial?.page ?? 1);
  const [hasNextPage, setHasNextPage] = useState(initial?.hasNextPage ?? false);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [source, setSource] = useState(initial?.source ?? 'offline');
  const [degraded, setDegraded] = useState(initial?.degraded ?? '');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  const tokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Skip the very first fetch when the server already streamed page 1 for the
  // default filters — otherwise every mount double-fetches.
  const skipInitialRef = useRef(Boolean(initial));

  const run = useCallback(
    async (targetPage: number, mode: 'replace' | 'append') => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const token = ++tokenRef.current;

      if (mode === 'replace') setLoading(true);
      else setLoadingMore(true);
      setError('');

      try {
        const response = await fetch(`/api/catalog?${buildQuery(filters, targetPage, perPage)}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as CatalogPage & { error?: string };
        if (token !== tokenRef.current) return;

        if (!response.ok) throw new Error(payload.error ?? `Catalog request failed (${response.status}).`);

        setItems((current) => (mode === 'append' ? [...current, ...payload.items] : payload.items));
        setPage(payload.page);
        setHasNextPage(payload.hasNextPage);
        setTotal(payload.total);
        setSource(payload.source);
        setDegraded(payload.degraded ?? '');
      } catch (caught) {
        if (controller.signal.aborted || token !== tokenRef.current) return;
        setError(caught instanceof Error ? caught.message : 'Could not reach the catalog.');
      } finally {
        if (token === tokenRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filters, perPage],
  );

  useEffect(() => {
    if (skipInitialRef.current) {
      skipInitialRef.current = false;
      return;
    }
    void run(1, 'replace');
  }, [run, nonce]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasNextPage) return;
    void run(page + 1, 'append');
  }, [hasNextPage, loading, loadingMore, page, run]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);

  return { items, loading, loadingMore, error, degraded, source, total, hasNextPage, loadMore, retry };
}

/** Debounces a fast-changing value (search box) before it hits the network. */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
