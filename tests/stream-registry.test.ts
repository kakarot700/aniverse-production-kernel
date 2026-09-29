import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeServers,
  getAllowedMediaHosts,
  getEpisodeMirrors,
  getRegistry,
  parseAllowedHostList,
  resetRegistry,
  titleKeysFor,
} from '../lib/streams/registry';
import type { AnimeSummary } from '../types/anime';

const ENV_KEYS = [
  'ANIVERSE_STREAM_SERVERS',
  'ANIVERSE_STREAM_SERVERS_FILE',
  'ANIVERSE_ENABLE_REFERENCE_STREAMS',
  'ANIVERSE_MEDIA_ALLOWED_HOSTS',
] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => void): void {
  const previous = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  resetRegistry();
  try {
    run();
  } finally {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of previous) if (value !== undefined) process.env[key] = value;
    resetRegistry();
  }
}

const anime: AnimeSummary = {
  id: 'anilist:21',
  anilistId: 21,
  malId: 21,
  slug: 'one-piece',
  title: 'One Piece',
  titles: { romaji: 'One Piece', english: 'One Piece', native: 'ONE PIECE' },
  synopsis: 'Pirates.',
  coverImage: 'https://example.com/cover.jpg',
  bannerImage: null,
  accentColor: null,
  genres: ['Action'],
  year: 1999,
  season: 'FALL',
  format: 'TV',
  status: 'RELEASING',
  episodeCount: 1100,
  durationMinutes: 24,
  averageScore: 88,
  popularity: 1,
  studios: ['Toei Animation'],
  isAdult: false,
  trailer: null,
  source: 'anilist',
};

test('the allowlist env parser trims, lowercases and drops blanks', () => {
  assert.deepEqual(parseAllowedHostList(' CDN.Example.com, ,*.assets.example. '), ['cdn.example.com', '*.assets.example']);
  assert.deepEqual(parseAllowedHostList(undefined), []);
});

test('a bare checkout still exposes playable reference servers', () => {
  withEnv({}, () => {
    const registry = getRegistry();
    assert.equal(registry.configuredCount, 0);
    assert.equal(registry.referenceStreamsEnabled, true);
    assert.ok(registry.servers.length >= 4);
    assert.ok(registry.servers.every((server) => server.isReference));
    assert.deepEqual(registry.issues, []);
  });
});

test('the proxy allowlist is derived from the configured servers, not just the env var', () => {
  withEnv({}, () => {
    const hosts = getAllowedMediaHosts();
    assert.ok(hosts.includes('test-streams.mux.dev'));
    assert.ok(hosts.includes('devstreaming-cdn.apple.com'));
    assert.ok(hosts.length > 0, 'a fresh checkout must not have an empty allowlist');
  });
});

test('operator servers outrank reference streams and contribute their hosts', () => {
  withEnv(
    {
      ANIVERSE_STREAM_SERVERS: JSON.stringify([
        {
          id: 'studio-cdn',
          name: 'Studio CDN',
          group: 'Licensed',
          language: 'sub',
          priority: 1,
          template: 'https://media.studio.example/{slug}/e{episode3}/master.m3u8',
        },
        {
          id: 'studio-dub',
          name: 'Studio CDN (dub)',
          group: 'Licensed',
          language: 'dub',
          priority: 2,
          requiresProxy: false,
          template: 'https://dub.studio.example/{anilistId}/{episode}.m3u8',
        },
      ]),
      ANIVERSE_MEDIA_ALLOWED_HOSTS: 'extra.example.com',
    },
    () => {
      const registry = getRegistry();
      assert.equal(registry.loadedFrom, 'env');
      assert.equal(registry.configuredCount, 2);
      assert.deepEqual(registry.servers.slice(0, 2).map((server) => server.id), ['studio-cdn', 'studio-dub']);

      const hosts = getAllowedMediaHosts();
      assert.ok(hosts.includes('media.studio.example'));
      assert.ok(hosts.includes('dub.studio.example'));
      assert.ok(hosts.includes('extra.example.com'));

      const mirrors = getEpisodeMirrors(anime, 7);
      assert.equal(mirrors[0].manifestUrl, 'https://media.studio.example/one-piece/e007/master.m3u8');
      assert.equal(mirrors[0].requiresProxy, true);
      assert.equal(mirrors[1].manifestUrl, 'https://dub.studio.example/21/7.m3u8');
      assert.equal(mirrors[1].requiresProxy, false);
      assert.ok(mirrors.slice(2).every((mirror) => mirror.isReference));
    },
  );
});

test('reference streams can be switched off once real servers exist', () => {
  withEnv(
    {
      ANIVERSE_ENABLE_REFERENCE_STREAMS: 'false',
      ANIVERSE_STREAM_SERVERS: JSON.stringify([
        { id: 'only', name: 'Only', template: 'https://only.example/{episode}.m3u8' },
      ]),
    },
    () => {
      const servers = describeServers();
      assert.deepEqual(servers.map((server) => server.id), ['only']);
      assert.equal(getRegistry().referenceStreamsEnabled, false);
    },
  );
});

test('malformed configuration degrades to reference streams and reports the reason', () => {
  withEnv({ ANIVERSE_STREAM_SERVERS: '{not json' }, () => {
    const registry = getRegistry();
    assert.equal(registry.configuredCount, 0);
    assert.equal(registry.issues.length, 1);
    assert.match(registry.issues[0].message, /not valid JSON/);
    assert.ok(registry.servers.length > 0, 'playback must keep working after a bad config');
  });
});

test('an unreadable server file is reported instead of crashing the registry', () => {
  withEnv({ ANIVERSE_STREAM_SERVERS_FILE: '/definitely/not/here.json' }, () => {
    const registry = getRegistry();
    assert.equal(registry.configuredCount, 0);
    assert.match(registry.issues[0].message, /could not be read/);
  });
});

test('title keys cover every id shape an operator might map against', () => {
  assert.deepEqual(titleKeysFor(anime).sort(), ['21', 'anilist:21', 'mal:21', 'one-piece'].sort());
});

test('the public server view never leaks URL templates', () => {
  withEnv(
    {
      ANIVERSE_STREAM_SERVERS: JSON.stringify([
        { id: 'secret', name: 'Secret', template: 'https://signed.example/secret-path/{episode}.m3u8' },
      ]),
    },
    () => {
      const serialized = JSON.stringify(describeServers());
      assert.ok(!serialized.includes('secret-path'));
      assert.ok(serialized.includes('Secret'));
    },
  );
});
