import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  STEERING_VERSION,
  applyUriReplacement,
  buildSteeringManifest,
  chooseTtlSeconds,
  isValidPathwayId,
  parseSteeringManifest,
  rankPathways,
  toPathwayId,
  type SteerableMirror,
} from '../lib/streams/steering';
import { createHealthBook, recordFailure, recordSuccess } from '../lib/streams/health';

const NOW = 1_700_000_000_000;

// ───────────────────────────── pathway ids ─────────────────────────────

test('pathway ids are restricted to the character set the spec allows', () => {
  assert.equal(isValidPathwayId('CDN-A'), true);
  assert.equal(isValidPathwayId('cdn_1.edge'), true);
  assert.equal(isValidPathwayId(''), false);
  assert.equal(isValidPathwayId('cdn a'), false);
  assert.equal(isValidPathwayId('cdn/a'), false);
  assert.equal(isValidPathwayId(42), false);
});

test('registry ids are sanitised into legal pathway ids', () => {
  // A conformant player ignores an illegal id *silently*, so sanitising at the
  // boundary is cheaper than debugging a player that refuses to steer.
  assert.equal(toPathwayId('reference-mux-multibitrate'), 'reference-mux-multibitrate');
  assert.equal(toPathwayId('server 01 (backup)'), 'server-01-backup');
  assert.equal(toPathwayId('!!!'), 'pathway');
  assert.ok(isValidPathwayId(toPathwayId('a b/c@d')));
});

// ───────────────────────────── building ─────────────────────────────

test('a built manifest carries the required fields', () => {
  const manifest = buildSteeringManifest(['cdn-a', 'cdn-b']);
  assert.equal(manifest.VERSION, STEERING_VERSION);
  assert.equal(manifest.TTL, DEFAULT_TTL_SECONDS);
  assert.deepEqual(manifest['PATHWAY-PRIORITY'], ['cdn-a', 'cdn-b']);
  assert.equal(manifest['RELOAD-URI'], undefined);
});

test('a duplicate pathway id appears only once', () => {
  // Spec: a Pathway ID MUST NOT appear more than once in PATHWAY-PRIORITY.
  const manifest = buildSteeringManifest(['cdn-a', 'cdn-b', 'cdn-a']);
  assert.deepEqual(manifest['PATHWAY-PRIORITY'], ['cdn-a', 'cdn-b']);
});

test('illegal pathway ids are dropped from a built manifest', () => {
  const manifest = buildSteeringManifest(['cdn a', 'cdn-b']);
  assert.deepEqual(manifest['PATHWAY-PRIORITY'], ['cdn-b']);
});

test('building with no usable pathway throws rather than emitting an invalid manifest', () => {
  assert.throws(() => buildSteeringManifest([]), /at least one Pathway/);
  assert.throws(() => buildSteeringManifest(['bad id', '']), /at least one Pathway/);
});

test('ttl is clamped into a sane range', () => {
  assert.equal(buildSteeringManifest(['a'], { ttlSeconds: 0 }).TTL, 1);
  assert.equal(buildSteeringManifest(['a'], { ttlSeconds: -50 }).TTL, 1);
  assert.equal(buildSteeringManifest(['a'], { ttlSeconds: 99_999 }).TTL, MAX_TTL_SECONDS);
  assert.equal(buildSteeringManifest(['a'], { ttlSeconds: 42.6 }).TTL, 43);
});

test('a clone with an illegal id or base is not emitted', () => {
  const manifest = buildSteeringManifest(['cdn-a'], {
    clones: [
      { ID: 'good', 'BASE-ID': 'cdn-a', 'URI-REPLACEMENT': { HOST: 'x.test' } },
      { ID: 'bad id', 'BASE-ID': 'cdn-a', 'URI-REPLACEMENT': {} },
    ],
  });
  assert.equal(manifest['PATHWAY-CLONES']?.length, 1);
  assert.equal(manifest['PATHWAY-CLONES']?.[0].ID, 'good');
});

// ───────────────────────────── parsing ─────────────────────────────

test('a valid manifest parses and computes its expiry', () => {
  const parsed = parseSteeringManifest(
    { VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['cdn-a', 'cdn-b'] },
    'https://x.test/steering',
    NOW,
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.manifest['PATHWAY-PRIORITY'], ['cdn-a', 'cdn-b']);
  assert.equal(parsed.expiresAt, NOW + 20_000);
  assert.equal(parsed.nextUri, 'https://x.test/steering');
});

test('a higher VERSION is refused outright', () => {
  // Misinterpreting steering is worse than not steering.
  assert.equal(
    parseSteeringManifest({ VERSION: 2, TTL: 20, 'PATHWAY-PRIORITY': ['a'] }, 'https://x.test/s', NOW),
    null,
  );
});

test('a manifest missing a required field is refused', () => {
  const base = { VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['a'] };
  assert.equal(parseSteeringManifest({ ...base, VERSION: undefined }, 'https://x.test/s'), null);
  assert.equal(parseSteeringManifest({ ...base, TTL: undefined }, 'https://x.test/s'), null);
  assert.equal(parseSteeringManifest({ ...base, 'PATHWAY-PRIORITY': undefined }, 'https://x.test/s'), null);
  assert.equal(parseSteeringManifest({ ...base, TTL: 0 }, 'https://x.test/s'), null);
  assert.equal(parseSteeringManifest({ ...base, VERSION: 1.5 }, 'https://x.test/s'), null);
});

test('non-object input is refused rather than throwing', () => {
  for (const input of [null, undefined, 'a string', 42, ['an', 'array']]) {
    assert.equal(parseSteeringManifest(input, 'https://x.test/s'), null);
  }
});

test('a manifest whose pathways are all invalid is refused', () => {
  assert.equal(
    parseSteeringManifest({ VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['bad id', ''] }, 'https://x.test/s'),
    null,
  );
});

test('unrecognised keys are ignored, not fatal', () => {
  const parsed = parseSteeringManifest(
    { VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['a'], 'FUTURE-KEY': { nested: true } },
    'https://x.test/s',
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.manifest['PATHWAY-PRIORITY'], ['a']);
});

test('a relative RELOAD-URI resolves against the current manifest uri', () => {
  const parsed = parseSteeringManifest(
    { VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['a'], 'RELOAD-URI': './steer.json?bucket=7' },
    'https://x.test/api/steering?v=1',
  );
  assert.equal(parsed?.nextUri, 'https://x.test/api/steer.json?bucket=7');
});

test('an absolute RELOAD-URI replaces the current uri', () => {
  const parsed = parseSteeringManifest(
    { VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['a'], 'RELOAD-URI': 'https://other.test/s' },
    'https://x.test/api/steering',
  );
  assert.equal(parsed?.nextUri, 'https://other.test/s');
});

test('a malformed RELOAD-URI falls back to the current uri instead of breaking steering', () => {
  // `new URL('ht!tp://:::', base)` does NOT throw -- an invalid scheme makes
  // the whole string resolve as a relative path, so a try/catch alone would
  // silently accept it and reload steering from a URL that 404s forever.
  const parsed = parseSteeringManifest(
    { VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['a'], 'RELOAD-URI': 'ht!tp://:::' },
    'https://x.test/api/steering',
  );
  assert.equal(parsed?.nextUri, 'https://x.test/api/steering');
});

test('a dangerous RELOAD-URI scheme is refused', () => {
  // A steering manifest is a trust boundary the moment it comes from anyone
  // but us, and this value is destined for a fetch.
  for (const hostile of ['javascript:alert(1)', 'data:text/json,{}', 'file:///etc/passwd']) {
    const parsed = parseSteeringManifest(
      { VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['a'], 'RELOAD-URI': hostile },
      'https://x.test/api/steering',
    );
    assert.equal(parsed?.nextUri, 'https://x.test/api/steering', `${hostile} must not be followed`);
    assert.equal(parsed?.manifest['RELOAD-URI'], undefined, 'and must not survive into the manifest');
  }
});

test('a protocol-relative RELOAD-URI keeps the current scheme', () => {
  const parsed = parseSteeringManifest(
    { VERSION: 1, TTL: 20, 'PATHWAY-PRIORITY': ['a'], 'RELOAD-URI': '//other.test/s' },
    'https://x.test/api/steering',
  );
  assert.equal(parsed?.nextUri, 'https://other.test/s');
});

test('a built manifest parses back cleanly', () => {
  const built = buildSteeringManifest(['cdn-a', 'cdn-b'], { ttlSeconds: 30, reloadUri: './next' });
  const parsed = parseSteeringManifest(JSON.parse(JSON.stringify(built)), 'https://x.test/api/steering');
  assert.ok(parsed);
  assert.deepEqual(parsed.manifest['PATHWAY-PRIORITY'], ['cdn-a', 'cdn-b']);
  assert.equal(parsed.manifest.TTL, 30);
});

// ───────────────────────────── pathway cloning ─────────────────────────────

test('a host replacement swaps the host and leaves the path alone', () => {
  const result = applyUriReplacement('https://a.test/video/12/hi.m3u8', { HOST: 'backup.test' });
  assert.equal(result, 'https://backup.test/video/12/hi.m3u8');
});

test('a host replacement may carry a port', () => {
  const result = applyUriReplacement('https://a.test/x.m3u8', { HOST: 'backup.test:8443' });
  assert.equal(result, 'https://backup.test:8443/x.m3u8');
});

test('params are injected and merged with an existing query string', () => {
  const result = applyUriReplacement('https://a.test/x.m3u8?keep=1', { PARAMS: { token: 'abc' } });
  const url = new URL(result);
  assert.equal(url.searchParams.get('keep'), '1');
  assert.equal(url.searchParams.get('token'), 'abc');
});

test('an empty param value revokes a previously injected param', () => {
  const result = applyUriReplacement('https://a.test/x.m3u8?token=old', { PARAMS: { token: '' } });
  assert.equal(new URL(result).searchParams.get('token'), null);
});

test('a per-variant uri overrides host and param surgery entirely', () => {
  const result = applyUriReplacement(
    'https://a.test/low.m3u8',
    { HOST: 'backup.test', 'PER-VARIANT-URIS': { 'Video-128': 'https://q.test/v12/low.m3u8' } },
    'Video-128',
  );
  assert.equal(result, 'https://q.test/v12/low.m3u8');
});

test('a per-rendition uri is honoured for audio renditions', () => {
  const result = applyUriReplacement(
    'https://a.test/eng.m3u8',
    { 'PER-RENDITION-URIS': { 'Audio-37262': 'https://q.test/v12/eng.m3u8' } },
    'Audio-37262',
  );
  assert.equal(result, 'https://q.test/v12/eng.m3u8');
});

test('a stable id with no override falls through to host replacement', () => {
  const result = applyUriReplacement(
    'https://a.test/hi.m3u8',
    { HOST: 'backup.test', 'PER-VARIANT-URIS': { 'Video-128': 'https://q.test/low.m3u8' } },
    'Video-768',
  );
  assert.equal(result, 'https://backup.test/hi.m3u8');
});

test('an unparseable uri is returned untouched rather than throwing', () => {
  assert.equal(applyUriReplacement('not a url', { HOST: 'x.test' }), 'not a url');
});

// ───────────────────────── health → priority bridge ─────────────────────────

const mirrors: SteerableMirror[] = [
  { id: 'a', priority: 100, pathwayId: 'cdn-a' },
  { id: 'b', priority: 200, pathwayId: 'cdn-b' },
  { id: 'c', priority: 300, pathwayId: 'cdn-c' },
];

test('with no history, ranking follows the operator priority', () => {
  assert.deepEqual(rankPathways(mirrors, createHealthBook(), { now: NOW }), ['cdn-a', 'cdn-b', 'cdn-c']);
});

test('a failing mirror is demoted below healthy ones', () => {
  const book = createHealthBook();
  recordFailure(book, 'a', NOW);
  const ranked = rankPathways(mirrors, book, { now: NOW });
  assert.equal(ranked[ranked.length - 1], 'cdn-a');
});

test('viewer distress demotes a pathway our own probe thought was fine', () => {
  // The whole point of ingesting CMCD: a synthetic probe measures a byte range
  // returning in 40ms, CMCD measures a real viewer watching a spinner.
  const book = createHealthBook();
  recordSuccess(book, 'a', 30, NOW);
  const ranked = rankPathways(mirrors, book, { now: NOW, distress: { 'cdn-a': 1 } });
  assert.notEqual(ranked[0], 'cdn-a');
});

test('mild distress does not overturn a large priority gap', () => {
  const ranked = rankPathways(mirrors, createHealthBook(), { now: NOW, distress: { 'cdn-a': 0.01 } });
  assert.equal(ranked[0], 'cdn-a');
});

test('several mirrors sharing a pathway yield that pathway only once', () => {
  const shared: SteerableMirror[] = [
    { id: 'a1', priority: 100, pathwayId: 'cdn-a' },
    { id: 'a2', priority: 150, pathwayId: 'cdn-a' },
    { id: 'b1', priority: 200, pathwayId: 'cdn-b' },
  ];
  const ranked = rankPathways(shared, createHealthBook(), { now: NOW });
  assert.deepEqual(ranked, ['cdn-a', 'cdn-b']);
  assert.equal(new Set(ranked).size, ranked.length);
});

test('a ranked list always builds into a valid manifest', () => {
  const book = createHealthBook();
  recordFailure(book, 'a', NOW);
  recordFailure(book, 'b', NOW);
  const manifest = buildSteeringManifest(rankPathways(mirrors, book, { now: NOW }));
  assert.equal(manifest['PATHWAY-PRIORITY'].length, 3);
  assert.ok(parseSteeringManifest(JSON.parse(JSON.stringify(manifest)), 'https://x.test/s'));
});

test('ttl shortens while the picture is unstable and relaxes when it is calm', () => {
  const book = createHealthBook();
  assert.equal(chooseTtlSeconds(mirrors, book, NOW), DEFAULT_TTL_SECONDS);

  recordFailure(book, 'a', NOW);
  const partial = chooseTtlSeconds(mirrors, book, NOW);
  assert.ok(partial < DEFAULT_TTL_SECONDS && partial >= 15);

  recordFailure(book, 'b', NOW);
  recordFailure(book, 'c', NOW);
  assert.equal(chooseTtlSeconds(mirrors, book, NOW), 10);
});

test('a recovered mirror restores the relaxed ttl', () => {
  const book = createHealthBook();
  recordFailure(book, 'a', NOW);
  recordSuccess(book, 'a', 40, NOW + 1);
  assert.equal(chooseTtlSeconds(mirrors, book, NOW + 1), DEFAULT_TTL_SECONDS);
});

test('viewer distress shortens the ttl even when no mirror is in cooldown', () => {
  // Found live: twelve viewers reported starvation, the pathways reordered
  // correctly, and every client was still told to wait five minutes before
  // asking again. The reroute was right and nobody heard about it.
  const relaxed = chooseTtlSeconds(mirrors, createHealthBook(), NOW, {});
  const urgent = chooseTtlSeconds(mirrors, createHealthBook(), NOW, { 'cdn-a': 0.9 });

  assert.equal(relaxed, DEFAULT_TTL_SECONDS);
  assert.ok(urgent < relaxed, `expected a shorter leash, got ${urgent}`);
});

test('trivial distress does not shorten the ttl', () => {
  assert.equal(chooseTtlSeconds(mirrors, createHealthBook(), NOW, { 'cdn-a': 0.05 }), DEFAULT_TTL_SECONDS);
});

test('distress across every pathway collapses the ttl to its floor', () => {
  const ttl = chooseTtlSeconds(mirrors, createHealthBook(), NOW, {
    'cdn-a': 0.9, 'cdn-b': 0.9, 'cdn-c': 0.9,
  });
  assert.equal(ttl, 10);
});

test('an empty mirror list does not divide by zero', () => {
  assert.equal(chooseTtlSeconds([], createHealthBook(), NOW, {}), DEFAULT_TTL_SECONDS);
});
