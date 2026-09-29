import assert from 'node:assert/strict';
import test from 'node:test';
import { SERVER_REGISTRY, getServerDefinition, orderedServers } from '../lib/servers/registry';
import { envKeyForServer, getServerRuntimeConfig, getSourceMapConfig } from '../lib/servers/config';
import { lookupSkipTimestamps, lookupSourceMap, sanitizeSourceMap } from '../lib/servers/source-map';
import { resolveEpisodeMirrors } from '../lib/servers/resolve';
import { isReferenceStreamsEnabled, pickReferenceStream } from '../lib/servers/reference-streams';
import { getEffectiveAllowedHosts } from '../lib/servers/allowlist';

/**
 * Every server that shipped in the original catalog matrix, by display name.
 * Removing or renaming one is a deliberate act and must update this list.
 */
const ORIGINAL_SERVERS = [
  'Vidstream / Vidplay',
  'MyCloud (MCloud)',
  'Filemoon',
  'DoodStream Node',
  'Streamtape Mirror',
  'Voe.sx Cluster',
  'Streamwish Node',
  'Vidhide Secure Node',
  'Mp4Upload High-Bitrate',
  'Netu.tv Resilient Core',
  'Mixdrop Alternative Path',
];

test('every original server is still present in the registry', () => {
  const names = SERVER_REGISTRY.map((server) => server.name);
  for (const expected of ORIGINAL_SERVERS) {
    assert.ok(names.includes(expected), `${expected} must remain in the registry`);
  }
});

test('registry entries are unique and completely specified', () => {
  const ids = SERVER_REGISTRY.map((server) => server.id);
  assert.equal(new Set(ids).size, ids.length, 'server ids must be unique');

  for (const server of SERVER_REGISTRY) {
    assert.match(server.id, /^[a-z0-9-]+$/, `${server.name} needs a slug id`);
    assert.ok(server.host.includes('.'), `${server.name} needs a hostname`);
    assert.ok(server.template.includes('{id}'), `${server.name} template needs an {id} placeholder`);
    assert.ok(server.note.length > 0, `${server.name} needs an operator note`);
    assert.ok(['hls', 'progressive', 'embed'].includes(server.kind));
    assert.ok(['open', 'premium', 'scaled', 'legacy'].includes(server.tier));
  }
});

test('servers are ordered open → premium → scaled → legacy', () => {
  const tiers = orderedServers().map((server) => server.tier);
  const rank = { open: 0, premium: 1, scaled: 2, legacy: 3 } as const;
  for (let index = 1; index < tiers.length; index += 1) {
    assert.ok(rank[tiers[index]] >= rank[tiers[index - 1]], 'tier ordering must be monotonic');
  }
});

test('environment key derivation handles hyphenated ids', () => {
  assert.equal(envKeyForServer('aniverse-origin'), 'ANIVERSE_SERVER_ANIVERSE_ORIGIN');
  assert.equal(envKeyForServer('filemoon'), 'ANIVERSE_SERVER_FILEMOON');
});

test('runtime config applies base URL overrides, rejects non-https, and honours the disable list', () => {
  const config = getServerRuntimeConfig({
    ANIVERSE_SERVER_FILEMOON: 'https://filemoon.example/',
    ANIVERSE_SERVER_VOE: 'http://insecure.example',
    ANIVERSE_SERVERS_DISABLED: 'mixdrop',
  } as unknown as NodeJS.ProcessEnv);

  const byId = new Map(config.map((entry) => [entry.definition.id, entry]));

  const filemoon = byId.get('filemoon');
  assert.ok(filemoon);
  assert.equal(filemoon.baseUrl, 'https://filemoon.example');
  assert.equal(filemoon.configured, true);
  assert.equal(filemoon.enabled, true);

  // An http override is ignored; the server falls back to its canonical host.
  const voe = byId.get('voe');
  assert.ok(voe);
  assert.equal(voe.configured, false);
  assert.equal(voe.baseUrl, 'https://voe.sx');

  const mixdrop = byId.get('mixdrop');
  assert.ok(mixdrop);
  assert.equal(mixdrop.enabled, false);
  assert.match(mixdrop.disabledReason ?? '', /ANIVERSE_SERVERS_DISABLED/);

  // `aniverse-origin` has a placeholder host and must be configured explicitly.
  const origin = byId.get('aniverse-origin');
  assert.ok(origin);
  assert.equal(origin.enabled, false);
  assert.match(origin.disabledReason ?? '', /ANIVERSE_SERVER_ANIVERSE_ORIGIN/);
});

test('source map sanitiser drops unsafe entries and keeps valid ones', () => {
  const map = sanitizeSourceMap({
    version: 1,
    entries: {
      'anilist:1': {
        '1': [
          { server: 'filemoon', fileId: 'abc-123', quality: '1080p', audio: 'sub' },
          { server: 'aniverse-origin', url: 'https://cdn.example.com/a/master.m3u8' },
          { server: 'voe', url: 'http://cdn.example.com/insecure.m3u8' },
          { server: 'voe', fileId: '../../etc/passwd' },
          { server: 'voe', fileId: 'ok', audio: 'nonsense' },
          { server: '', fileId: 'orphan' },
          { fileId: 'no-server' },
          'garbage',
        ],
      },
      broken: 'not-an-object',
    },
  });

  const entries = lookupSourceMap(map, 'anilist:1', 1);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { server: 'filemoon', fileId: 'abc-123', quality: '1080p', audio: 'sub' });
  assert.equal(entries[1].url, 'https://cdn.example.com/a/master.m3u8');
  // Path-traversal file id is stripped, but the harmless `ok` entry survives
  // with its invalid audio hint discarded.
  assert.deepEqual(entries[2], { server: 'voe', fileId: 'ok' });
  assert.equal(lookupSourceMap(map, 'broken', 1).length, 0);
  assert.equal(lookupSourceMap(map, 'missing', 9).length, 0);
});

test('sanitiser tolerates junk input without throwing', () => {
  assert.deepEqual(sanitizeSourceMap(null).entries, {});
  assert.deepEqual(sanitizeSourceMap('nope').entries, {});
  assert.deepEqual(sanitizeSourceMap({ entries: [] }).entries, {});
});

test('source map config only accepts an https endpoint', () => {
  assert.equal(getSourceMapConfig({ ANIVERSE_SOURCE_MAP_URL: 'https://maps.example/map.json' } as unknown as NodeJS.ProcessEnv).present, true);
  assert.equal(getSourceMapConfig({ ANIVERSE_SOURCE_MAP_URL: 'http://maps.example/map.json' } as unknown as NodeJS.ProcessEnv).present, false);
  assert.equal(getSourceMapConfig({ ANIVERSE_SOURCE_MAP_INLINE: '{"entries":{}}' } as unknown as NodeJS.ProcessEnv).present, true);
  assert.equal(getSourceMapConfig({} as unknown as NodeJS.ProcessEnv).present, false);
});

test('reference streams are deterministic and opt-out in production', () => {
  const first = pickReferenceStream('anilist:16498', 1);
  assert.deepEqual(first, pickReferenceStream('anilist:16498', 1));
  assert.notDeepEqual(first, pickReferenceStream('anilist:16498', 1, 1));

  assert.equal(isReferenceStreamsEnabled({ NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(isReferenceStreamsEnabled({ NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(
    isReferenceStreamsEnabled({ NODE_ENV: 'production', ANIVERSE_ENABLE_REFERENCE_STREAMS: 'true' } as unknown as NodeJS.ProcessEnv),
    true,
  );
});

test('the reference host is merged into the proxy allowlist only while enabled', () => {
  const enabled = getEffectiveAllowedHosts({
    NODE_ENV: 'development',
    ANIVERSE_MEDIA_ALLOWED_HOSTS: 'cdn.example.com',
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(enabled, ['cdn.example.com', 'test-streams.mux.dev']);

  const disabled = getEffectiveAllowedHosts({
    NODE_ENV: 'production',
    ANIVERSE_MEDIA_ALLOWED_HOSTS: 'cdn.example.com',
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(disabled, ['cdn.example.com']);
});

test('resolver returns a slot for every server, with honest per-server status', () => {
  const servers = getServerRuntimeConfig({} as unknown as NodeJS.ProcessEnv);
  const mirrors = resolveEpisodeMirrors('anilist:16498', 1, {
    servers,
    sourceMap: sanitizeSourceMap({ entries: {} }),
    allowedHosts: ['test-streams.mux.dev'],
    referenceStreamsEnabled: true,
  });

  // One slot per server, plus the extra `open-cinema` alt mirror.
  assert.equal(mirrors.length, SERVER_REGISTRY.length + 1);

  const ready = mirrors.filter((mirror) => mirror.status === 'ready');
  assert.equal(ready.length, 2, 'both reference mirrors resolve with no configuration');
  assert.ok(ready.every((mirror) => mirror.manifestUrl.startsWith('https://test-streams.mux.dev/')));

  // Ready mirrors sort ahead of unusable ones so failover never wastes a hop.
  assert.equal(mirrors[0].status, 'ready');
  assert.equal(mirrors[1].status, 'ready');

  const filemoon = mirrors.find((mirror) => mirror.serverId === 'filemoon');
  assert.ok(filemoon);
  assert.equal(filemoon.status, 'unmapped');
  assert.equal(filemoon.manifestUrl, '');

  const origin = mirrors.find((mirror) => mirror.serverId === 'aniverse-origin');
  assert.ok(origin);
  assert.equal(origin.status, 'unconfigured');
});

test('a mapped embed server resolves to a sandboxed iframe URL, never a proxy target', () => {
  const servers = getServerRuntimeConfig({} as unknown as NodeJS.ProcessEnv);
  const mirrors = resolveEpisodeMirrors('anilist:16498', 1, {
    servers,
    sourceMap: sanitizeSourceMap({
      entries: { 'anilist:16498': { '1': [{ server: 'filemoon', fileId: 'k2m9xq1p', quality: '720p' }] } },
    }),
    allowedHosts: [],
    referenceStreamsEnabled: false,
  });

  const filemoon = mirrors.find((mirror) => mirror.serverId === 'filemoon');
  assert.ok(filemoon);
  assert.equal(filemoon.status, 'ready');
  assert.equal(filemoon.kind, 'embed');
  assert.equal(filemoon.embedUrl, 'https://filemoon.sx/e/k2m9xq1p');
  assert.equal(filemoon.manifestUrl, '');
  assert.equal(filemoon.requiresProxy, false);
  assert.equal(filemoon.quality, '720p');
});

test('an HLS mirror on a non-allowlisted host is reported as blocked, not ready', () => {
  const servers = getServerRuntimeConfig({
    ANIVERSE_SERVER_ANIVERSE_ORIGIN: 'https://cdn.example.com',
  } as unknown as NodeJS.ProcessEnv);

  const sourceMap = sanitizeSourceMap({
    entries: {
      'anilist:1': { '1': [{ server: 'aniverse-origin', url: 'https://cdn.example.com/a/master.m3u8' }] },
    },
  });

  const blocked = resolveEpisodeMirrors('anilist:1', 1, {
    servers,
    sourceMap,
    allowedHosts: [],
    referenceStreamsEnabled: false,
  }).find((mirror) => mirror.serverId === 'aniverse-origin');
  assert.ok(blocked);
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.statusDetail ?? '', /cdn\.example\.com/);

  const allowed = resolveEpisodeMirrors('anilist:1', 1, {
    servers,
    sourceMap,
    allowedHosts: ['cdn.example.com'],
    referenceStreamsEnabled: false,
  }).find((mirror) => mirror.serverId === 'aniverse-origin');
  assert.ok(allowed);
  assert.equal(allowed.status, 'ready');
  assert.equal(allowed.kind, 'hls');
  assert.equal(allowed.requiresProxy, true);
});

test('registry lookup by id works for every declared server', () => {
  for (const server of SERVER_REGISTRY) {
    assert.equal(getServerDefinition(server.id)?.name, server.name);
  }
  assert.equal(getServerDefinition('does-not-exist'), undefined);
});

test('skip timestamps are sanitised and surfaced per episode', () => {
  const map = sanitizeSourceMap({
    entries: {
      'anilist:1': {
        '1': [
          { server: 'filemoon', fileId: 'a', skip: { introStart: 0, introEnd: 90, outroStart: 1320, outroEnd: 1400 } },
        ],
        // Reversed intro window: nonsensical, so the whole skip block is dropped.
        '2': [{ server: 'filemoon', fileId: 'b', skip: { introStart: 90, introEnd: 10, outroStart: 1, outroEnd: 2 } }],
        // Partial windows are dropped rather than half-applied.
        '3': [{ server: 'filemoon', fileId: 'c', skip: { introStart: 0, introEnd: 90 } }],
        '4': [{ server: 'filemoon', fileId: 'd', skip: { introStart: -5, introEnd: 90, outroStart: 1, outroEnd: 2 } }],
        '5': [{ server: 'filemoon', fileId: 'e' }],
      },
    },
  });

  assert.deepEqual(lookupSkipTimestamps(map, 'anilist:1', 1), {
    introStart: 0,
    introEnd: 90,
    outroStart: 1320,
    outroEnd: 1400,
  });
  assert.equal(lookupSkipTimestamps(map, 'anilist:1', 2), undefined);
  assert.equal(lookupSkipTimestamps(map, 'anilist:1', 3), undefined);
  assert.equal(lookupSkipTimestamps(map, 'anilist:1', 4), undefined);
  assert.equal(lookupSkipTimestamps(map, 'anilist:1', 5), undefined);
  assert.equal(lookupSkipTimestamps(map, 'anilist:999', 1), undefined);

  // A dropped skip block must not invalidate the mirror it was attached to.
  assert.equal(lookupSourceMap(map, 'anilist:1', 2).length, 1);
});
