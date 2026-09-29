'use client';

import { useMemo, useState } from 'react';
import type { MediaEpisodePayload } from '@/types/media';

interface EpisodeRailProps {
  episodes: MediaEpisodePayload[];
  selected: number;
  onSelect: (episodeNumber: number) => void;
}

const CHUNK_SIZE = 100;

/**
 * Episode picker that stays usable for very long series.
 *
 * One Piece has >1100 episodes, so the list is paged into blocks of 100
 * instead of rendering every button at once.
 */
export function EpisodeRail({ episodes, selected, onSelect }: EpisodeRailProps) {
  const chunks = useMemo(() => {
    const result: MediaEpisodePayload[][] = [];
    for (let index = 0; index < episodes.length; index += CHUNK_SIZE) {
      result.push(episodes.slice(index, index + CHUNK_SIZE));
    }
    return result.length ? result : [[]];
  }, [episodes]);

  const selectedChunk = Math.max(
    0,
    chunks.findIndex((chunk) => chunk.some((episode) => episode.episodeNumber === selected)),
  );
  const [chunkIndex, setChunkIndex] = useState(selectedChunk);
  const activeChunk = chunks[Math.min(chunkIndex, chunks.length - 1)] ?? [];

  if (episodes.length <= 1) return null;

  return (
    <section className="episode-rail" aria-labelledby="episode-rail-title">
      <div className="episode-rail-head">
        <h3 id="episode-rail-title">Episodes</h3>
        <span className="episode-rail-count">{episodes.length} total</span>
      </div>

      {chunks.length > 1 ? (
        <div className="episode-ranges" role="tablist" aria-label="Episode ranges">
          {chunks.map((chunk, index) => {
            const first = chunk[0]?.episodeNumber ?? 1;
            const last = chunk[chunk.length - 1]?.episodeNumber ?? first;
            return (
              <button
                key={`${first}-${last}`}
                type="button"
                role="tab"
                aria-selected={index === chunkIndex}
                className="episode-range"
                onClick={() => setChunkIndex(index)}
              >
                {first}–{last}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="episode-grid">
        {activeChunk.map((episode) => (
          <button
            key={episode.episodeNumber}
            type="button"
            className={`episode-button${episode.episodeNumber === selected ? ' is-selected' : ''}`}
            aria-current={episode.episodeNumber === selected}
            onClick={() => onSelect(episode.episodeNumber)}
            title={episode.episodeTitle}
          >
            {episode.episodeNumber}
          </button>
        ))}
      </div>
    </section>
  );
}
