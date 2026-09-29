'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAniListCatalog, fetchAniListDetail } from '@/lib/anime/anilist';
import type { AnimeDetail, AnimeSummary, CatalogPage, CatalogQuery } from '@/types/anime';
import type { WatchPayload } from '@/types/media';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function toSearchParams(query: CatalogQuery): string {
  const params = new URLSearchParams({
    mode: query.mode,
    page: String(query.page),
    perPage: String(query.perPage),
  });
  if (query.search) params.set('q', query.search);
  if (query.genre) params.set('genre', query.genre);
  if (query.format) params.set('format', query.format);
  if (query.season) params.set('season', query.season);
  if (query.year) params.set('year', String(query.year));
  return params.toString();
}

/**
 * Loads a catalog page through our own API and, if the server reports that
 * every upstream source was unreachable, retries the identical query straight
 * from the browser. AniList sends permissive CORS headers, so a viewer whose
 * own network can reach it still gets the full catalog even when the app
 * server is sandboxed or offline.
 */
async function loadCatalogPage(query: CatalogQuery, signal: AbortSignal): Promise<CatalogPage> {
  let serverPage: CatalogPage | null = null;
  try {
    const response = await fetch(`/api/catalog?${toSearchParams(query)}`, { signal, headers: { Accept: 'application/json' } });
    if (response.ok) {
      serverPage = (await response.json()) as CatalogPage;
      if (!serverPage.degraded) return serverPage;
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }

  try {
    const direct = await fetchAniListCatalog(query, signal);
    return { ...direct, notice: null };
  } catch (error) {
    if (signal.aborted) throw error;
    if (serverPage) return serverPage;
    throw error;
  }
}

export interface CatalogFilters {
  mode: CatalogQuery['mode'];
  search: string;
  genre: string;
  format: string;
  season: string;
  year: number | null;
  perPage?: number;
  /** Server-rendered first page, used to avoid an empty first paint. */
  initialPage?: CatalogPage | null;
}

export interface UseCatalogResult {
  items: AnimeSummary[];
  page: CatalogPage | null;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  degraded: boolean;
  hasNextPage: boolean;
  total: number;
  loadMore: () => void;
  reload: () => void;
}

export function useCatalog(filters: CatalogFilters): UseCatalogResult {
  const perPage = filters.perPage ?? 24;
  const key = `${filters.mode}|${filters.search}|${filters.genre}|${filters.format}|${filters.season}|${filters.year ?? ''}|${perPage}`;

  const seed = filters.initialPage ?? null;
  const [items, setItems] = useState<AnimeSummary[]>(seed?.items ?? []);
  const [page, setPage] = useState<CatalogPage | null>(seed);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const pageNumberRef = useRef(1);
  const inflightRef = useRef<AbortController | null>(null);

  const baseQuery = useMemo<CatalogQuery>(
    () => ({
      mode: filters.mode,
      search: filters.search,
      genre: filters.genre,
      format: filters.format,
      season: filters.season,
      year: filters.year,
      page: 1,
      perPage,
    }),
    [filters.format, filters.genre, filters.mode, filters.search, filters.season, filters.year, perPage],
  );

  useEffect(() => {
    const controller = new AbortController();
    inflightRef.current?.abort();
    inflightRef.current = controller;
    pageNumberRef.current = 1;
    setLoading(true);
    setError('');

    loadCatalogPage(baseQuery, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.items);
        setPage(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setPage(null);
        setError(cause instanceof Error ? cause.message : 'The catalog could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // `key` collapses the filter object into a primitive so identical filters
    // never re-trigger a fetch.
  }, [baseQuery, key, reloadToken]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !page?.pageInfo.hasNextPage) return;
    const controller = new AbortController();
    const nextPage = pageNumberRef.current + 1;
    setLoadingMore(true);

    loadCatalogPage({ ...baseQuery, page: nextPage }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        pageNumberRef.current = nextPage;
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...result.items.filter((item) => !seen.has(item.id))];
        });
        setPage(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'More results could not be loaded.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false);
      });
  }, [baseQuery, loading, loadingMore, page?.pageInfo.hasNextPage]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    items,
    page,
    loading,
    loadingMore,
    error,
    degraded: Boolean(page?.degraded),
    hasNextPage: Boolean(page?.pageInfo.hasNextPage),
    total: page?.pageInfo.total ?? items.length,
    loadMore,
    reload,
  };
}

export interface UseAnimeDetailResult {
  detail: AnimeDetail | null;
  loading: boolean;
  error: string;
}

export function useAnimeDetail(animeId: string | null, fallback?: AnimeSummary | null): UseAnimeDetailResult {
  const [detail, setDetail] = useState<AnimeDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(animeId));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!animeId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');

    const run = async () => {
      let serverDetail: AnimeDetail | null = null;
      try {
        const response = await fetch(`/api/anime/${encodeURIComponent(animeId)}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          const payload = (await response.json()) as { anime: AnimeDetail | null };
          serverDetail = payload.anime ?? null;
          if (serverDetail && serverDetail.source !== 'offline') {
            setDetail(serverDetail);
            return;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }

      // The server could not reach a live source: try AniList straight from
      // here, where the viewer's own connection usually can.
      const anilistId = fallback?.anilistId ?? Number.parseInt(animeId.replace(/^anilist:/, ''), 10);
      if (Number.isFinite(anilistId) && anilistId > 0) {
        try {
          const direct = await fetchAniListDetail({ anilistId }, controller.signal);
          if (direct) {
            setDetail(direct);
            return;
          }
        } catch {
          // fall through to whatever the server managed to return
        }
      }

      if (controller.signal.aborted) return;
      setDetail(serverDetail);
      if (!serverDetail) setError('This title could not be loaded right now.');
    };

    void run().finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [animeId, fallback?.anilistId]);

  return { detail, loading, error };
}

export interface UseWatchSourcesResult {
  payload: WatchPayload | null;
  loading: boolean;
  error: string;
}

/**
 * Resolves the ranked server list for one episode.
 *
 * The summary we already hold is forwarded as hints so the server can still
 * build mirror URLs while its own catalog sources are unreachable.
 */
export function useWatchSources(
  anime: Pick<AnimeSummary, 'id' | 'slug' | 'title' | 'year' | 'season' | 'malId' | 'episodeCount'> | null,
  episodeNumber: number | null,
): UseWatchSourcesResult {
  const [payload, setPayload] = useState<WatchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const animeId = anime?.id ?? null;
  const hints = anime
    ? new URLSearchParams(
        Object.entries({
          slug: anime.slug,
          title: anime.title,
          year: anime.year != null ? String(anime.year) : '',
          season: anime.season ?? '',
          malId: anime.malId != null ? String(anime.malId) : '',
          episodes: anime.episodeCount != null ? String(anime.episodeCount) : '',
        }).filter((entry): entry is [string, string] => Boolean(entry[1])),
      ).toString()
    : '';

  useEffect(() => {
    if (!animeId || !episodeNumber) {
      setPayload(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetch(`/api/watch/${encodeURIComponent(animeId)}/${episodeNumber}${hints ? `?${hints}` : ''}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Server list unavailable (${response.status}).`);
        return (await response.json()) as WatchPayload;
      })
      .then((result) => {
        if (!controller.signal.aborted) setPayload(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(cause instanceof Error ? cause.message : 'Stream servers could not be resolved.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [animeId, episodeNumber, hints]);

  return { payload, loading, error };
}
