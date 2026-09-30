import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_SERVERS_FILE, describeServers, getRegistry, type PublicServerInfo } from '@/lib/streams/registry';
import type { RegistrySnapshot } from '@/lib/streams/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Stream servers — Aniverse',
  description:
    'Registry status and the paste-in bracket for adding your own anime stream servers.',
};

const LOADED_FROM_LABEL: Record<RegistrySnapshot['loadedFrom'], string> = {
  env: 'ANIVERSE_STREAM_SERVERS environment variable',
  file: 'ANIVERSE_STREAM_SERVERS_FILE environment variable',
  'default-file': `${DEFAULT_SERVERS_FILE} (auto-detected)`,
  none: `no operator configuration — reference streams only`,
};

/** The minimal bracket a viewer copies into config/stream-servers.json. */
const BRACKET_SNIPPET = [
  {
    id: 'my-anime',
    name: 'My Anime Server',
    group: 'Licensed',
    language: 'sub',
    kind: 'hls',
    priority: 10,
    enabled: true,
    template: 'https://your-cdn.example.com/anime/{slug}/{episode}/index.m3u8',
  },
];

const TOKEN_ROWS: Array<{ token: string; example: string }> = [
  { token: '{slug}', example: 'one-piece' },
  { token: '{anilistId}', example: '21' },
  { token: '{malId}', example: '21' },
  { token: '{title}', example: 'One%20Piece' },
  { token: '{year}', example: '1999' },
  { token: '{season}', example: 'fall' },
  { token: '{episode}', example: '7' },
  { token: '{episode2}', example: '07' },
  { token: '{episode3}', example: '007' },
];

const LANGUAGE_LABEL: Record<string, string> = { sub: 'SUB', dub: 'DUB', raw: 'RAW', mixed: '—' };

function ServerTable({ servers }: { servers: PublicServerInfo[] }) {
  return (
    <div className="servers-table-wrap">
      <table className="servers-table">
        <thead>
          <tr>
            <th scope="col">Server</th>
            <th scope="col">Language</th>
            <th scope="col">Type</th>
            <th scope="col">Priority</th>
            <th scope="col">Connection</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <tr key={server.id} className={server.isReference ? 'is-reference' : undefined}>
              <td>
                <span className="servers-server-name">{server.name}</span>
                {server.quality ? <span className="server-tag">{server.quality}</span> : null}
                {server.note ? <span className="servers-server-note">{server.note}</span> : null}
              </td>
              <td>{LANGUAGE_LABEL[server.language] ?? server.language.toUpperCase()}</td>
              <td>{server.kind.toUpperCase()}</td>
              <td>{server.priority}</td>
              <td>{server.requiresProxy ? 'Proxied' : 'Direct'}</td>
              <td>
                <span className={server.enabled ? 'servers-badge is-on' : 'servers-badge is-off'}>
                  {server.enabled ? 'On' : 'Off'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ServersPage() {
  const registry = getRegistry();
  const servers = describeServers();
  const groups = [...new Set(servers.map((server) => server.group))];
  const licensed = servers.filter((server) => !server.isReference);
  const reference = servers.filter((server) => server.isReference);
  const enabled = servers.filter((server) => server.enabled);

  return (
    <div className="site-shell">
      <div className="mesh-backdrop" aria-hidden="true" />
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Aniverse home">
          <span className="brand-mark" aria-hidden="true">a</span>
          <span>ANIVERSE</span>
        </Link>
        <nav className="header-nav" aria-label="Servers navigation">
          <Link href="/">← Back to the catalog</Link>
        </nav>
        <span className="header-note">Registry</span>
      </header>

      <main className="servers-main">
        <p className="eyebrow">Registry</p>
        <h1>Stream servers</h1>
        <p className="servers-lede">
          {servers.length} registered · {enabled.length} enabled · {licensed.length} of your own ·{' '}
          {reference.length} reference. Loaded from{' '}
          <strong>{LOADED_FROM_LABEL[registry.loadedFrom]}</strong>.
        </p>

        <section className="servers-card" aria-labelledby="servers-issues-title">
          <h2 id="servers-issues-title">Configuration status</h2>
          {registry.issues.length === 0 ? (
            <p className="servers-ok">
              <span aria-hidden="true">✓</span> Every configured server is valid. No issues.
            </p>
          ) : (
            <ul className="servers-issues">
              {registry.issues.map((issue, index) => (
                <li key={`${issue.id}-${index}`}>
                  <code>{issue.id || 'configuration'}</code>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
          {registry.allowedHosts.length > 0 ? (
            <p className="servers-hosts">
              Proxy allowlist: {registry.allowedHosts.map((host) => <code key={host}>{host}</code>)}
            </p>
          ) : null}
        </section>

        <section className="servers-card" aria-labelledby="servers-how-title">
          <h2 id="servers-how-title">Add your anime server</h2>
          <ol className="servers-steps">
            <li>
              Open <code>{DEFAULT_SERVERS_FILE}</code> in the project root — it ships with placeholder brackets
              named <code>PASTE-…-HERE</code>.
            </li>
            <li>
              Paste your stream URL into a <code>template</code> bracket. A bare URL (no tokens) serves that one
              video for every episode; tokens make it per-episode:
            </li>
          </ol>
          <pre className="servers-code">
            <code>{JSON.stringify(BRACKET_SNIPPET, null, 2)}</code>
          </pre>
          <div className="servers-tokens">
            <p className="servers-tokens-title">Tokens you can use inside the URL:</p>
            <ul>
              {TOKEN_ROWS.map((row) => (
                <li key={row.token}>
                  <code>{row.token}</code>
                  <span>→ {row.example}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="servers-fineprint">
            Restart the app after editing — the registry is read once per process. URLs must be public HTTPS on
            port 443: no <code>http://</code>, IP addresses, <code>localhost</code>, or credentials. A home
            server needs a real hostname and certificate (reverse proxy or tunnel) before it can be added.
            Configure only origins you own, operate, or are licensed to distribute from.
          </p>
        </section>

        <section className="servers-card" aria-labelledby="servers-list-title">
          <h2 id="servers-list-title">Registered servers</h2>
          {servers.length === 0 ? (
            <p className="servers-empty">No servers are registered. Playback will not work yet.</p>
          ) : (
            groups.map((group) => (
              <div className="servers-group" key={group}>
                <p className="server-group-label">{group}</p>
                <ServerTable servers={servers.filter((server) => server.group === group)} />
              </div>
            ))
          )}
          <p className="servers-fineprint">
            Lower priority ranks first; the player walks the list and fails over automatically. Reference
            streams are public test assets (Mux, Apple, Blender open movies) so playback works before you
            configure anything real.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span>Aniverse — ranked mirrors, automatic failover, same-origin proxy.</span>
          <span>
            <Link href="/">Catalog</Link> · <a href="/api/servers">/api/servers</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
