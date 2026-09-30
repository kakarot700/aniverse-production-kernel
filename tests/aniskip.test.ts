import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkipTimesUrl, fetchSkipTimes, parseSkipTimes } from '../lib/anime/aniskip';

const EPISODE_LENGTH = 1_417.16;

function payload(results: unknown[]) {
  return { found: true, results, message: 'Successfully found skip times', statusCode: 200 };
}

test('a normal op/ed payload maps to intro and outro', () => {
  const skip = parseSkipTimes(
    payload([
      { interval: { startTime: 310.5, endTime: 400.5 }, skipType: 'op', episodeLength: EPISODE_LENGTH },
      { interval: { startTime: 1321.01, endTime: 1401.16 }, skipType: 'ed', episodeLength: EPISODE_LENGTH },
    ]),
    EPISODE_LENGTH,
  );

  assert.ok(skip);
  assert.equal(skip.introStart, 310.5);
  assert.equal(skip.introEnd, 400.5);
  assert.equal(skip.outroStart, 1321.01);
  assert.equal(skip.outroEnd, 1401.16);
});

test('a not-found response yields null', () => {
  assert.equal(parseSkipTimes({ found: false, results: [] }, EPISODE_LENGTH), null);
  assert.equal(parseSkipTimes(null, EPISODE_LENGTH), null);
  assert.equal(parseSkipTimes('nonsense', EPISODE_LENGTH), null);
  assert.equal(parseSkipTimes({ found: true }, EPISODE_LENGTH), null);
});

test('an episode with only an opening still produces a usable result', () => {
  const skip = parseSkipTimes(
    payload([{ interval: { startTime: 120, endTime: 210 }, skipType: 'op' }]),
    EPISODE_LENGTH,
  );
  assert.ok(skip);
  assert.equal(skip.introEnd, 210);
  assert.equal(skip.outroStart, 0, 'no ending was submitted');
});

test('a recap stands in for a missing opening', () => {
  const skip = parseSkipTimes(
    payload([{ interval: { startTime: 12, endTime: 95 }, skipType: 'recap' }]),
    EPISODE_LENGTH,
  );
  assert.ok(skip);
  assert.equal(skip.introStart, 12);
  assert.equal(skip.introEnd, 95);
});

test('a real opening beats a recap when both are present', () => {
  const skip = parseSkipTimes(
    payload([
      { interval: { startTime: 10, endTime: 80 }, skipType: 'recap' },
      { interval: { startTime: 95, endTime: 185 }, skipType: 'op' },
    ]),
    EPISODE_LENGTH,
  );
  assert.ok(skip);
  assert.equal(skip.introStart, 95, 'the opening wins');
});

test('mixed-op is ignored but mixed-ed is accepted', () => {
  const mixedOpOnly = parseSkipTimes(
    payload([{ interval: { startTime: 60, endTime: 150 }, skipType: 'mixed-op' }]),
    EPISODE_LENGTH,
  );
  assert.equal(mixedOpOnly, null, 'an opening overlaid on story content is not a clean skip');

  const mixedEd = parseSkipTimes(
    payload([{ interval: { startTime: 1300, endTime: 1400 }, skipType: 'mixed-ed' }]),
    EPISODE_LENGTH,
  );
  assert.ok(mixedEd);
  assert.equal(mixedEd.outroStart, 1300);
});

test('implausible and malformed intervals are dropped', () => {
  const skip = parseSkipTimes(
    payload([
      { interval: { startTime: 10, endTime: 11 }, skipType: 'op' },
      { interval: { startTime: 'x', endTime: 200 }, skipType: 'op' },
      { interval: { startTime: 50, endTime: 40 }, skipType: 'op' },
      { interval: { startTime: 100, endTime: 900 }, skipType: 'op' },
      null,
      { skipType: 'op' },
    ]),
    EPISODE_LENGTH,
  );
  assert.equal(skip, null, 'too short, non-numeric, inverted and absurdly long are all rejected');
});

test('a segment starting past the end of the episode is stale data', () => {
  const skip = parseSkipTimes(
    payload([{ interval: { startTime: 2_000, endTime: 2_090 }, skipType: 'op' }]),
    EPISODE_LENGTH,
  );
  assert.equal(skip, null);
});

test('an overrunning ending is clamped to the episode duration', () => {
  const skip = parseSkipTimes(
    payload([{ interval: { startTime: 1_380, endTime: 1_600 }, skipType: 'ed' }]),
    EPISODE_LENGTH,
  );
  assert.ok(skip);
  assert.equal(skip.outroEnd, EPISODE_LENGTH);
});

test('the latest ending wins when several are submitted', () => {
  const skip = parseSkipTimes(
    payload([
      { interval: { startTime: 700, endTime: 790 }, skipType: 'ed' },
      { interval: { startTime: 1_300, endTime: 1_390 }, skipType: 'ed' },
    ]),
    EPISODE_LENGTH,
  );
  assert.ok(skip);
  assert.equal(skip.outroStart, 1_300, 'the real credits roll is the later one');
});

test('the request URL carries every required parameter', () => {
  const url = new URL(buildSkipTimesUrl(21, 7, 1_417.1567));
  assert.equal(url.pathname, '/v2/skip-times/21/7');
  assert.deepEqual(url.searchParams.getAll('types'), ['op', 'ed', 'recap']);
  assert.equal(url.searchParams.get('episodeLength'), '1417.157', 'three decimal places at most');
});

test('fetch rejects nonsense input without touching the network', async () => {
  let called = false;
  const spy: typeof fetch = async () => {
    called = true;
    return new Response('{}');
  };

  assert.equal(await fetchSkipTimes(0, 1, 100, { fetchImpl: spy }), null);
  assert.equal(await fetchSkipTimes(21, 0, 100, { fetchImpl: spy }), null);
  assert.equal(await fetchSkipTimes(21, 1, 0, { fetchImpl: spy }), null);
  assert.equal(called, false);
});

test('a 404 resolves to null rather than throwing', async () => {
  const notFound: typeof fetch = async () => new Response('{}', { status: 404 });
  assert.equal(await fetchSkipTimes(21, 1, 1_417, { fetchImpl: notFound }), null);
});

test('a network failure resolves to null rather than throwing', async () => {
  const boom: typeof fetch = async () => {
    throw new Error('offline');
  };
  assert.equal(await fetchSkipTimes(21, 1, 1_417, { fetchImpl: boom }), null);
});

test('a successful fetch returns parsed timestamps', async () => {
  const ok: typeof fetch = async () =>
    new Response(
      JSON.stringify(payload([{ interval: { startTime: 100, endTime: 190 }, skipType: 'op' }])),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const skip = await fetchSkipTimes(21, 1, 1_417, { fetchImpl: ok });
  assert.ok(skip);
  assert.equal(skip.introEnd, 190);
});
