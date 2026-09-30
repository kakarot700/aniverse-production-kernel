import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expandTemplate,
  isSafeMediaEndpoint,
  padEpisode,
  parseServerDefinitions,
  REFERENCE_SERVERS,
  resolveEpisodeMirrors,
  staticHostsForDefinition,
  type StreamServerDefinition,
  type TitleTokens,
} from '../lib/streams/definitions';

const tokens: TitleTokens = {
  anilistId: 21,
  malId: 142,
  slug: 'one-piece',
  title: 'One Piece',
  year: 1999,
  season: 'FALL',
};

function definition(overrides: Partial<StreamServerDefinition> = {}): StreamServerDefinition {
  return {
    id: 'test-server',
    name: 'Test Server',
    group: 'Licensed',
    language: 'sub',
    kind: 'hls',
    priority: 10,
    requiresProxy: true,
    template: 'https://cdn.example.com/{slug}/{episode3}/master.m3u8',
    scope: 'universal',
    enabled: true,
    isReference: false,
    ...overrides,
  };
}

test('episode numbers pad to the requested width', () => {
  assert.equal(padEpisode(7, 2), '07');
  assert.equal(padEpisode(7, 3), '007');
  assert.equal(padEpisode(1075, 3), '1075');
});

test('templates expand every supported token', () => {
  const url = expandTemplate(
    'https://cdn.example.com/{anilistId}/{malId}/{slug}/{year}/{season}/{episode}-{episode2}-{episode3}.m3u8',
    tokens,
    7,
  );
  assert.equal(url, 'https://cdn.example.com/21/142/one-piece/1999/fall/7-07-007.m3u8');
});

test('templates that need a missing identifier resolve to nothing instead of a broken URL', () => {
  const anonymous: TitleTokens = { anilistId: null, malId: null, slug: 'demo', title: 'Demo', year: null, season: null };
  assert.equal(expandTemplate('https://cdn.example.com/{anilistId}/master.m3u8', anonymous, 1), null);
  assert.equal(expandTemplate('https://cdn.example.com/{slug}/master.m3u8', anonymous, 1), 'https://cdn.example.com/demo/master.m3u8');
});

test('title tokens are URL-encoded so odd titles cannot break out of the path', () => {
  const odd: TitleTokens = { anilistId: 1, malId: null, slug: 'a b', title: 'Re:Zero ?x=1#y', year: null, season: null };
  const url = expandTemplate('https://cdn.example.com/{slug}/{title}/master.m3u8', odd, 1);
  assert.equal(url, 'https://cdn.example.com/a%20b/Re%3AZero%20%3Fx%3D1%23y/master.m3u8');
  assert.equal(new URL(url!).pathname, '/a%20b/Re%3AZero%20%3Fx%3D1%23y/master.m3u8');
  assert.equal(new URL(url!).search, '');
});

test('only public HTTPS endpoints are accepted', () => {
  assert.equal(isSafeMediaEndpoint('https://cdn.example.com/a.m3u8'), true);
  assert.equal(isSafeMediaEndpoint('http://cdn.example.com/a.m3u8'), false);
  assert.equal(isSafeMediaEndpoint('https://user:pass@cdn.example.com/a.m3u8'), false);
  assert.equal(isSafeMediaEndpoint('https://cdn.example.com:8443/a.m3u8'), false);
  assert.equal(isSafeMediaEndpoint('https://127.0.0.1/a.m3u8'), false);
  assert.equal(isSafeMediaEndpoint('https://localhost/a.m3u8'), false);
  assert.equal(isSafeMediaEndpoint('https://box.internal/a.m3u8'), false);
  assert.equal(isSafeMediaEndpoint('not a url'), false);
});

test('static hosts are extracted for the proxy allowlist and templated hosts are skipped', () => {
  assert.deepEqual(staticHostsForDefinition(definition()), ['cdn.example.com']);
  assert.deepEqual(
    staticHostsForDefinition(definition({ template: 'https://{slug}.cdn.example.com/master.m3u8' })),
    [],
  );
  assert.deepEqual(
    staticHostsForDefinition(
      definition({
        scope: 'mapped',
        template: '',
        titles: { 'anilist:21': 'https://mapped.example.com/one-piece/{episode3}.m3u8' },
        episodes: { 'anilist:21': { '1': 'https://episode-cdn.example.com/playback-id.m3u8' } },
      }),
    ).sort(),
    ['episode-cdn.example.com', 'mapped.example.com'],
  );
});

test('operator definitions are validated and bad entries are reported rather than fatal', () => {
  const { servers, issues } = parseServerDefinitions([
    { id: 'good', name: 'Good', template: 'https://a.example.com/{episode}.m3u8', priority: 5 },
    { id: '', name: 'No id', template: 'https://b.example.com/x.m3u8' },
    { id: 'good', name: 'Duplicate', template: 'https://c.example.com/x.m3u8' },
    { id: 'no-template' },
    { id: 'mapped-empty', scope: 'mapped' },
    'nonsense',
  ]);

  assert.deepEqual(servers.map((server) => server.id), ['good']);
  assert.equal(servers[0].requiresProxy, true);
  assert.equal(servers[0].enabled, true);
  assert.equal(issues.length, 5);
  assert.ok(issues.some((issue) => /Missing "id"/.test(issue.message)));
  assert.ok(issues.some((issue) => /Duplicate/.test(issue.message)));
  assert.ok(issues.some((issue) => /need a "template"/.test(issue.message)));
  assert.ok(issues.some((issue) => /non-empty "titles" or "episodes"/.test(issue.message)));
});

test('dormant bracket placeholders are ignored until one URL is pasted', () => {
  const dormant = parseServerDefinitions([
    { id: 'slot-01', placeholder: true, template: '[PASTE LICENSED HLS URL HERE]' },
  ]);
  assert.deepEqual(dormant, { servers: [], issues: [] });

  const active = parseServerDefinitions([
    { id: 'slot-01', placeholder: true, template: 'https://cdn.example.com/{episode}.m3u8' },
  ]);
  assert.equal(active.issues.length, 0);
  assert.equal(active.servers[0]?.id, 'slot-01');
});

test('a non-array configuration is rejected with a single clear issue', () => {
  const { servers, issues } = parseServerDefinitions({ id: 'nope' });
  assert.equal(servers.length, 0);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /JSON array/);
});

test('mirrors resolve in priority order, deduplicated, honouring mapped scope', () => {
  const mirrors = resolveEpisodeMirrors(
    [
      definition({ id: 'secondary', name: 'Secondary', priority: 50 }),
      definition({
        id: 'primary',
        name: 'Primary',
        priority: 1,
        template: 'https://primary.example.com/{slug}/{episode}.m3u8',
      }),
      definition({
        id: 'mapped-hit',
        name: 'Mapped Hit',
        priority: 5,
        scope: 'mapped',
        template: '',
        titles: { 'anilist:21': 'https://mapped.example.com/{episode2}.m3u8' },
      }),
      definition({
        id: 'mapped-miss',
        name: 'Mapped Miss',
        priority: 6,
        scope: 'mapped',
        template: '',
        titles: { 'anilist:999': 'https://other.example.com/{episode}.m3u8' },
      }),
      definition({ id: 'disabled', name: 'Disabled', priority: 2, enabled: false }),
      definition({ id: 'duplicate-url', name: 'Duplicate URL', priority: 99 }),
    ],
    tokens,
    7,
    ['anilist:21', 'one-piece'],
  );

  assert.deepEqual(mirrors.map((mirror) => mirror.id), ['primary', 'mapped-hit', 'secondary']);
  assert.equal(mirrors[0].manifestUrl, 'https://primary.example.com/one-piece/7.m3u8');
  assert.equal(mirrors[1].manifestUrl, 'https://mapped.example.com/07.m3u8');
  assert.equal(mirrors[2].manifestUrl, 'https://cdn.example.com/one-piece/007/master.m3u8');
});

test('exact episode maps support random CDN playback ids and outrank title templates', () => {
  const parsed = parseServerDefinitions([
    {
      id: 'mapped-assets',
      name: 'Mapped assets',
      scope: 'mapped',
      titles: { 'anilist:21': 'https://fallback.example.com/one-piece/{episode}.m3u8' },
      episodes: {
        'anilist:21': {
          '1': 'https://stream.mux.com/episode-one-playback-id.m3u8',
          '2': 'https://customer-code.cloudflarestream.com/episode-two-id/manifest/video.m3u8',
        },
      },
    },
    {
      id: 'episodes-only',
      scope: 'mapped',
      episodes: { 'anilist:21': { '7': 'https://video.example.com/random-id.m3u8' } },
    },
  ]);
  assert.equal(parsed.issues.length, 0);

  const first = resolveEpisodeMirrors(parsed.servers, tokens, 1, ['anilist:21']);
  assert.equal(first[0]?.manifestUrl, 'https://stream.mux.com/episode-one-playback-id.m3u8');

  const seventh = resolveEpisodeMirrors(parsed.servers, tokens, 7, ['anilist:21']);
  assert.deepEqual(
    seventh.map((mirror) => mirror.manifestUrl),
    [
      'https://fallback.example.com/one-piece/7.m3u8',
      'https://video.example.com/random-id.m3u8',
    ],
  );

  assert.deepEqual(resolveEpisodeMirrors(parsed.servers, tokens, 3, ['anilist:999']), []);
});

test('insecure or unresolvable templates never reach the player', () => {
  const mirrors = resolveEpisodeMirrors(
    [
      definition({ id: 'plain-http', template: 'http://cdn.example.com/{episode}.m3u8' }),
      definition({ id: 'loopback', template: 'https://127.0.0.1/{episode}.m3u8' }),
      definition({ id: 'needs-mal', template: 'https://cdn.example.com/{malId}/{episode}.m3u8' }),
    ],
    { anilistId: 1, malId: null, slug: 's', title: 'S', year: null, season: null },
    1,
    ['anilist:1'],
  );
  assert.deepEqual(mirrors, []);
});

test('bundled reference servers are real, safe HTTPS endpoints and are flagged as references', () => {
  assert.ok(REFERENCE_SERVERS.length >= 4);
  for (const server of REFERENCE_SERVERS) {
    assert.ok(isSafeMediaEndpoint(server.template), `${server.id} must be a safe HTTPS endpoint`);
    assert.equal(server.isReference, true, `${server.id} must be flagged as a reference stream`);
    assert.equal(server.scope, 'universal');
    assert.ok(server.note && server.note.length > 0, `${server.id} must document its source`);
    assert.ok(server.priority >= 900, `${server.id} must rank below operator-configured servers`);
  }
  const ids = REFERENCE_SERVERS.map((server) => server.id);
  assert.equal(new Set(ids).size, ids.length, 'reference server ids must be unique');
});

test('reference servers resolve for any title, including ones with no external ids', () => {
  const mirrors = resolveEpisodeMirrors(
    REFERENCE_SERVERS,
    { anilistId: null, malId: null, slug: 'offline-title', title: 'Offline Title', year: null, season: null },
    1,
    ['offline:title'],
  );
  assert.equal(mirrors.length, REFERENCE_SERVERS.length);
  assert.ok(mirrors.every((mirror) => mirror.isReference));
});

test('client-supplied identifiers cannot escape the path segment the template puts them in', () => {
  const hostile: TitleTokens = {
    anilistId: 1,
    malId: null,
    slug: '../../../etc/passwd',
    title: '//attacker.example/x',
    year: null,
    season: null,
  };
  const url = expandTemplate('https://cdn.example.com/{slug}/{title}/master.m3u8', hostile, 1);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'cdn.example.com');
  assert.equal(parsed.pathname, '/..%2F..%2F..%2Fetc%2Fpasswd/%2F%2Fattacker.example%2Fx/master.m3u8');
  assert.ok(!parsed.pathname.split('/').includes('..'));
});
