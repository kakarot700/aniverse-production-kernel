'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AnimeEpisode } from '@/types/anime';

interface EpisodeGridProps {
  episodes: AnimeEpisode[];
  activeEpisode: number;
  onSelect: (episodeNumber: number) => void;
}

const BLOCK_SIZE = 100;

/**
 * Long-running shows have 1000+ entries, so episodes are chunked into blocks
 * instead of rendering thousands of buttons at once.
 */
export function EpisodeGrid({ episodes, activeEpisode, onSelect }: EpisodeGridProps) {
  const blocks = useMemo(() => {
    const result: Array<{ start: number; end: number; items: AnimeEpisode[] }> = [];
    for (let index = 0; index < episodes.length; index += BLOCK_SIZE) {
      const items = episodes.slice(index, index + BLOCK_SIZE);
      if (items.length === 0) continue;
      result.push({ start: items[0].number, end: items[items.length - 1].number, items });
    }
    return result;
  }, [episodes]);

  const activeBlockIndex = Math.max(
    0,
    blocks.findIndex((block) => activeEpisode >= block.start && activeEpisode <= block.end),
  );
  const [blockIndex, setBlockIndex] = useState(activeBlockIndex);

  useEffect(() => {
    setBlockIndex(activeBlockIndex);
  }, [activeBlockIndex]);

  if (episodes.length === 0) {
    return <p className="episode-empty">No episode list has been published for this title yet.</p>;
  }

  const block = blocks[Math.min(blockIndex, blocks.length - 1)] ?? blocks[0];
  const detailed = block.items.some((episode) => episode.title && !/^episode\s*\d+$/i.test(episode.title));

  return (
    <div className="episode-panel">
      <div className="episode-head">
        <h4>Episodes</h4>
        {blocks.length > 1 ? (
          <label className="episode-range">
            <span className="sr-only">Episode range</span>
            <select value={blockIndex} onChange={(event) => setBlockIndex(Number(event.target.value))}>
              {blocks.map((entry, index) => (
                <option key={entry.start} value={index}>
                  {entry.start}–{entry.end}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="episode-count">{episodes.length} total</span>
        )}
      </div>

      {detailed ? (
        <ul className="episode-list">
          {block.items.map((episode) => (
            <li key={episode.number}>
              <button
                type="button"
                className="episode-row"
                aria-current={episode.number === activeEpisode}
                onClick={() => onSelect(episode.number)}
              >
                <span className="episode-index">{episode.number}</span>
                <span className="episode-title">{episode.title}</span>
                {!episode.aired ? <span className="episode-flag">Unaired</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="episode-numbers">
          {block.items.map((episode) => (
            <button
              key={episode.number}
              type="button"
              className="episode-chip"
              aria-current={episode.number === activeEpisode}
              disabled={!episode.aired}
              onClick={() => onSelect(episode.number)}
            >
              {episode.number}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
