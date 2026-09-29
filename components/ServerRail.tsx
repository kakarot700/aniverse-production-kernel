'use client';

import type { StreamMirrorNode } from '@/types/media';

interface ServerRailProps {
  mirrors: StreamMirrorNode[];
  activeIndex: number | null;
  loading: boolean;
  notice: string | null;
  onSelect: (index: number) => void;
}

const LANGUAGE_LABEL: Record<string, string> = {
  sub: 'SUB',
  dub: 'DUB',
  raw: 'RAW',
  mixed: '—',
};

export function ServerRail({ mirrors, activeIndex, loading, notice, onSelect }: ServerRailProps) {
  const groups = mirrors.reduce<Map<string, Array<{ mirror: StreamMirrorNode; index: number }>>>((acc, mirror, index) => {
    const bucket = acc.get(mirror.group) ?? [];
    bucket.push({ mirror, index });
    acc.set(mirror.group, bucket);
    return acc;
  }, new Map());

  return (
    <section className="server-rail" aria-labelledby="server-rail-title">
      <div className="server-rail-head">
        <h4 id="server-rail-title">Servers</h4>
        <span>{loading ? 'Resolving…' : `${mirrors.length} available`}</span>
      </div>

      {loading ? (
        <div className="server-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : mirrors.length === 0 ? (
        <p className="server-empty">No stream server can serve this episode yet.</p>
      ) : (
        [...groups.entries()].map(([group, entries]) => (
          <div className="server-group" key={group}>
            <p className="server-group-label">{group}</p>
            <div className="server-buttons">
              {entries.map(({ mirror, index }) => (
                <button
                  key={mirror.id}
                  type="button"
                  className="server-button"
                  aria-pressed={activeIndex === index}
                  onClick={() => onSelect(index)}
                  title={mirror.note ?? mirror.serverName}
                >
                  <span className="server-name">{mirror.serverName}</span>
                  <span className="server-tags">
                    <span className="server-tag">{LANGUAGE_LABEL[mirror.language] ?? mirror.language.toUpperCase()}</span>
                    {mirror.quality ? <span className="server-tag">{mirror.quality}</span> : null}
                    <span className="server-tag">{mirror.kind.toUpperCase()}</span>
                    {mirror.requiresProxy === false ? <span className="server-tag is-direct">DIRECT</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {notice ? <p className="server-notice">{notice}</p> : null}
    </section>
  );
}
