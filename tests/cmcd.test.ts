import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CMCD_QUERY_KEY,
  LOW_BUFFER_MS,
  appendCmcdToUrl,
  cmcdHeaders,
  extractCmcd,
  parseCmcd,
  quoteCmcdString,
  readDistress,
  serializeCmcd,
  stripCmcd,
} from '../lib/streams/cmcd';

// ───────────────────────────── serialization ─────────────────────────────

test('keys serialize in alphabetical order', () => {
  // Spec item 9: a fixed order reduces the player's fingerprinting surface.
  const payload = serializeCmcd({ sid: 'abc', br: 3000, ot: 'v', bl: 20_000 });
  assert.equal(payload, 'bl=20000,br=3000,ot=v,sid="abc"');
});

test('a true boolean is a bare key and a false boolean is omitted', () => {
  assert.equal(serializeCmcd({ bs: true, su: true }), 'bs,su');
  assert.equal(serializeCmcd({ bs: false, su: true }), 'su');
  assert.equal(serializeCmcd({ bs: false }), '');
});

test('strings are quoted and tokens are not', () => {
  const payload = serializeCmcd({ sid: 'session-1', ot: 'm', sf: 'h', st: 'v' });
  assert.equal(payload, 'ot=m,sf=h,sid="session-1",st=v');
});

test('quotes and backslashes inside a string are escaped', () => {
  assert.equal(quoteCmcdString('a"b'), '"a\\"b"');
  assert.equal(quoteCmcdString('a\\b'), '"a\\\\b"');
  assert.equal(serializeCmcd({ cid: 'he said "hi"' }), 'cid="he said \\"hi\\""');
});

test('buffer, deadline and throughput are rounded to the nearest 100', () => {
  // Spec: these are rounded to reduce fingerprinting entropy.
  assert.equal(serializeCmcd({ bl: 21_345 }), 'bl=21300');
  assert.equal(serializeCmcd({ dl: 1_049 }), 'dl=1000');
  assert.equal(serializeCmcd({ mtp: 15_678 }), 'mtp=15700');
  assert.equal(serializeCmcd({ rtp: 4_449 }), 'rtp=4400');
});

test('bitrate and duration are NOT rounded to 100', () => {
  assert.equal(serializeCmcd({ br: 3_123, d: 4_004 }), 'br=3123,d=4004');
});

test('version 1 is omitted and other versions are sent', () => {
  // Spec: the version key should only be reported when it is not 1.
  assert.equal(serializeCmcd({ v: 1, br: 100 }), 'br=100');
  assert.equal(serializeCmcd({ v: 2, br: 100 }), 'br=100,v=2');
});

test('a playback rate of 1 is omitted as redundant', () => {
  assert.equal(serializeCmcd({ pr: 1, br: 100 }), 'br=100');
  assert.equal(serializeCmcd({ pr: 1.5, br: 100 }), 'br=100,pr=1.5');
});

test('negative and non-finite numbers are dropped rather than emitted', () => {
  assert.equal(serializeCmcd({ bl: -5, br: 100 }), 'br=100');
  assert.equal(serializeCmcd({ mtp: Number.NaN, br: 100 }), 'br=100');
  assert.equal(serializeCmcd({ br: Number.POSITIVE_INFINITY }), '');
});

test('session and content ids are truncated to the 64 character maximum', () => {
  const long = 'x'.repeat(200);
  const payload = serializeCmcd({ sid: long });
  assert.equal(payload, `sid="${'x'.repeat(64)}"`);
});

test('custom keys require a hyphenated prefix', () => {
  assert.equal(serializeCmcd({ custom: { 'com.aniverse-mirror': 'mux' } }), 'com.aniverse-mirror="mux"');
  // An unprefixed custom key risks colliding with a future reserved key.
  assert.equal(serializeCmcd({ custom: { mirror: 'mux' } }), '');
});

test('an empty payload serializes to an empty string', () => {
  assert.equal(serializeCmcd({}), '');
});

// ───────────────────────────── transmission ─────────────────────────────

test('query mode url-encodes the payload and respects an existing query string', () => {
  const plain = appendCmcdToUrl('https://cdn.test/seg.ts', { br: 3000, ot: 'v' });
  assert.equal(plain, `https://cdn.test/seg.ts?${CMCD_QUERY_KEY}=br%3D3000%2Cot%3Dv`);

  const existing = appendCmcdToUrl('https://cdn.test/seg.ts?token=1', { ot: 'v' });
  assert.equal(existing, `https://cdn.test/seg.ts?token=1&${CMCD_QUERY_KEY}=ot%3Dv`);
});

test('an empty payload leaves the url untouched', () => {
  assert.equal(appendCmcdToUrl('https://cdn.test/seg.ts', {}), 'https://cdn.test/seg.ts');
});

test('header mode shards keys into the four defined headers', () => {
  const headers = cmcdHeaders({
    br: 3000, ot: 'v', bl: 20_000, su: true, bs: true, sid: 'session-1', cid: 'content-1',
  });

  assert.equal(headers['CMCD-Object'], 'br=3000,ot=v');
  assert.equal(headers['CMCD-Request'], 'bl=20000,su');
  assert.equal(headers['CMCD-Status'], 'bs');
  assert.equal(headers['CMCD-Session'], 'cid="content-1",sid="session-1"');
});

test('custom keys land in the session header', () => {
  const headers = cmcdHeaders({ custom: { 'com.aniverse-mirror': 'mux' } });
  assert.equal(headers['CMCD-Session'], 'com.aniverse-mirror="mux"');
});

test('headers are omitted entirely when they would be empty', () => {
  const headers = cmcdHeaders({ br: 3000 });
  assert.equal(headers['CMCD-Object'], 'br=3000');
  assert.equal(headers['CMCD-Request'], undefined);
  assert.equal(headers['CMCD-Status'], undefined);
});

// ───────────────────────────── parsing ─────────────────────────────

test('a round trip preserves every value', () => {
  const original = { br: 3000, bl: 20_000, bs: true, sid: 'session-1', ot: 'v' as const, mtp: 15_000 };
  const parsed = parseCmcd(serializeCmcd(original));

  assert.equal(parsed.br, 3000);
  assert.equal(parsed.bl, 20_000);
  assert.equal(parsed.bs, true);
  assert.equal(parsed.sid, 'session-1');
  assert.equal(parsed.ot, 'v');
  assert.equal(parsed.mtp, 15_000);
});

test('commas inside a quoted value do not split the payload', () => {
  // `nor` is a URL and can legitimately contain a comma.
  const parsed = parseCmcd('nor="../seg,2.ts",br=3000');
  assert.equal(parsed.nor, '../seg,2.ts');
  assert.equal(parsed.br, 3000);
});

test('escaped quotes inside a value survive parsing', () => {
  const parsed = parseCmcd('cid="he said \\"hi\\"",br=100');
  assert.equal(parsed.cid, 'he said "hi"');
  assert.equal(parsed.br, 100);
});

test('a bare key parses as boolean true', () => {
  const parsed = parseCmcd('bs,su,br=100');
  assert.equal(parsed.bs, true);
  assert.equal(parsed.su, true);
  assert.equal(parsed.br, 100);
});

test('unknown keys are preserved rather than rejected', () => {
  // Spec section 5: a server MUST ignore keys it does not understand, and a
  // future key must not cost us the ones we do understand.
  const parsed = parseCmcd('br=100,zz=42,com.other-key="v"');
  assert.equal(parsed.br, 100);
  assert.equal(parsed.zz, 42);
  assert.equal(parsed['com.other-key'], 'v');
});

test('malformed pairs are skipped without losing the valid ones', () => {
  const parsed = parseCmcd('br=100,,=novalue,key=,mtp=500');
  assert.equal(parsed.br, 100);
  assert.equal(parsed.mtp, 500);
  assert.equal(parsed.key, undefined);
});

test('values that merely look numeric to JavaScript are kept as strings', () => {
  // `Number()` happily accepts these; the structured-field grammar does not.
  const parsed = parseCmcd('a=Infinity,b=0x10,c=1e5,d=-12.5');
  assert.equal(parsed.a, 'Infinity');
  assert.equal(parsed.b, '0x10');
  assert.equal(parsed.c, '1e5');
  assert.equal(parsed.d, -12.5);
});

test('parsing empty or absent input yields an empty object', () => {
  assert.deepEqual(parseCmcd(''), {});
  assert.deepEqual(parseCmcd(null), {});
  assert.deepEqual(parseCmcd(undefined), {});
});

test('extraction prefers the query argument and falls back to headers', () => {
  const withQuery = new URL(`https://x.test/s.ts?${CMCD_QUERY_KEY}=${encodeURIComponent('br=3000')}`);
  assert.equal(extractCmcd(withQuery, new Headers()).br, 3000);

  const headers = new Headers({ 'CMCD-Object': 'br=1500', 'CMCD-Status': 'bs' });
  const parsed = extractCmcd(new URL('https://x.test/s.ts'), headers);
  assert.equal(parsed.br, 1500);
  assert.equal(parsed.bs, true);
});

test('CMCD is strippable so it never pollutes a cache key', () => {
  const url = new URL(`https://x.test/s.ts?token=1&${CMCD_QUERY_KEY}=br%3D3000`);
  const stripped = stripCmcd(url);
  assert.equal(stripped.searchParams.get(CMCD_QUERY_KEY), null);
  assert.equal(stripped.searchParams.get('token'), '1');
  // The original must not be mutated.
  assert.notEqual(url.searchParams.get(CMCD_QUERY_KEY), null);
});

// ───────────────────────────── distress ─────────────────────────────

test('buffer starvation is maximum distress', () => {
  const distress = readDistress(parseCmcd('bs,bl=0'));
  assert.equal(distress.starved, true);
  assert.equal(distress.severity, 1);
});

test('a healthy buffer registers no distress', () => {
  const distress = readDistress(parseCmcd('bl=30000,mtp=15000'));
  assert.equal(distress.starved, false);
  assert.equal(distress.severity, 0);
  assert.equal(distress.throughputKbps, 15_000);
});

test('a draining buffer is detected before the stall actually happens', () => {
  // The whole point: by the time `bs` arrives the viewer already saw a spinner.
  const nearlyEmpty = readDistress(parseCmcd(`bl=${LOW_BUFFER_MS / 4}`));
  const comfortable = readDistress(parseCmcd(`bl=${LOW_BUFFER_MS - 100}`));

  assert.ok(nearlyEmpty.severity > comfortable.severity);
  assert.ok(nearlyEmpty.severity > 0 && nearlyEmpty.severity < 1);
  assert.ok(comfortable.severity < 0.1);
});

test('a missing buffer report is not treated as an empty buffer', () => {
  const distress = readDistress(parseCmcd('br=3000'));
  assert.equal(distress.bufferMs, null);
  assert.equal(distress.severity, 0);
});
