'use client';

import { useEffect, useState } from 'react';
import { CatalogCard } from '@/components/CatalogCard';
import type { CatalogPage, MediaCatalogRecord } from '@/types/media';

interface CatalogShelfProps {
  title: string;
  caption?: string;
  /** Namespaced catalog ids, in display order. */
  ids: string[];
  onSelect: (item: MediaCatalogRecord) => void;
  /** Rendered under each card, e.g. "Episode 4 · 12:30". */
  renderFootnote?: (item: MediaCatalogRecord) => string | null;
  emptyLabel?: string;
}

/**
 * Horizontal shelf built from stored ids (watchlist, playback history).
 *
 * Records are resolved in one batched request rather than one per card.
 */
export function CatalogShelf({ title, caption, ids, onSelect, renderFootnote, emptyLabel }: CatalogShelfProps) {
  const [items, setItems] = useState<MediaCatalogRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Primitive dependency: the array identity changes on every parent render.
  const key = ids.join(',');

  useEffect(() => {
    if (!key) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/catalog?ids=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<CatalogPage>)
      .then((payload) => setItems(payload.items ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setItems([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [key]);

  if (!key && !emptyLabel) return null;

  return (
    <section className="shelf" aria-labelledby={`shelf-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <div className="shelf-head">
        <h2 id={`shelf-${title.replace(/\s+/g, '-').toLowerCase()}`}>{title}</h2>
        {caption ? <p>{caption}</p> : null}
      </div>

      {loading && items.length === 0 ? (
        <div className="shelf-track" aria-hidden="true">
          {Array.from({ length: 6 }, (_unused, index) => (
            <div key={index} className="shelf-item card-skeleton" />
          ))}
        </div>
      ) : items.length ? (
        <div className="shelf-track">
          {items.map((item) => {
            const footnote = renderFootnote?.(item) ?? null;
            return (
              <div key={item.id} className="shelf-item">
                <CatalogCard item={item} onSelect={onSelect} />
                {footnote ? <p className="shelf-footnote">{footnote}</p> : null}
              </div>
            );
          })}
        </div>
      ) : emptyLabel ? (
        <p className="empty-state">{emptyLabel}</p>
      ) : null}
    </section>
  );
}
