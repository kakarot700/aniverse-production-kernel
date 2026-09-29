'use client';

import type { MirrorStatus, StreamMirrorNode } from '@/types/media';
import type { MirrorProbe } from '@/components/MasterPlayer';

interface ServerRailProps {
  mirrors: StreamMirrorNode[];
  health: Record<string, MirrorProbe>;
  /** Server the player actually connected to. */
  activeServerId: string;
  /** Server the user pinned, or '' for automatic failover. */
  selectedServerId: string;
  onSelect: (serverId: string) => void;
  sourceMapConfigured: boolean;
}

const STATUS_LABEL: Record<MirrorStatus, string> = {
  ready: 'Ready',
  unmapped: 'No source',
  unconfigured: 'Not configured',
  disabled: 'Disabled',
  blocked: 'Not allowlisted',
};

const TIER_LABEL: Record<StreamMirrorNode['tier'], string> = {
  open: 'Open',
  premium: 'Premium',
  scaled: 'Scaled',
  legacy: 'Legacy',
};

export function ServerRail({
  mirrors,
  health,
  activeServerId,
  selectedServerId,
  onSelect,
  sourceMapConfigured,
}: ServerRailProps) {
  const readyCount = mirrors.filter((mirror) => mirror.status === 'ready').length;

  return (
    <section className="server-rail" aria-labelledby="server-rail-title">
      <div className="server-rail-head">
        <h3 id="server-rail-title">Stream servers</h3>
        <span className="server-rail-count">
          {readyCount} of {mirrors.length} ready
        </span>
      </div>

      <div className="server-list" role="radiogroup" aria-label="Choose a stream server">
        <button
          type="button"
          role="radio"
          aria-checked={selectedServerId === ''}
          className={`server-chip${selectedServerId === '' ? ' is-selected' : ''}`}
          onClick={() => onSelect('')}
        >
          <span className="server-chip-main">
            <span className="server-chip-name">Automatic</span>
            <span className="server-tier">Failover</span>
          </span>
          <span className="server-chip-meta">Fastest responding server</span>
        </button>

        {mirrors.map((mirror, index) => {
          const probe = health[mirror.serverId];
          const isReady = mirror.status === 'ready';
          const isActive = activeServerId === mirror.serverId;
          const key = `${mirror.serverId}-${index}`;

          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selectedServerId === mirror.serverId}
              className={`server-chip${selectedServerId === mirror.serverId ? ' is-selected' : ''}${isReady ? '' : ' is-unavailable'}`}
              disabled={!isReady}
              onClick={() => onSelect(mirror.serverId)}
              title={mirror.statusDetail ?? mirror.serverName}
            >
              <span className="server-chip-main">
                <span className="server-chip-name">
                  {mirror.serverName}
                  {isActive ? <span className="server-live" aria-label="currently playing" /> : null}
                </span>
                <span className="server-tier">{TIER_LABEL[mirror.tier]}</span>
              </span>
              <span className="server-chip-meta">
                <span className={`server-status server-status-${mirror.status}`}>{STATUS_LABEL[mirror.status]}</span>
                {mirror.kind === 'embed' ? <span>Embed</span> : null}
                {mirror.quality ? <span>{mirror.quality}</span> : null}
                {mirror.audio ? <span>{mirror.audio.toUpperCase()}</span> : null}
                {probe ? <span>{probe.ok ? `${probe.latencyMs} ms` : (probe.detail ?? 'Failed')}</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      {!sourceMapConfigured ? (
        <p className="server-rail-hint">
          Third-party servers stay on <strong>No source</strong> until you point{' '}
          <code>ANIVERSE_SOURCE_MAP_URL</code> (or <code>ANIVERSE_SOURCE_MAP_INLINE</code>) at a map of episode → file
          ids for content you are licensed to distribute. See <code>docs/SERVERS.md</code>.
        </p>
      ) : null}
    </section>
  );
}
