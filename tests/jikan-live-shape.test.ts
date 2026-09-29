/**
 * Contract test against a *recorded real* Jikan v4 response.
 *
 * The other mapper tests use hand-written objects, which only ever prove that
 * the mapper agrees with the test author's idea of the API. This fixture was
 * captured from the live service (see tests/fixtures/jikan-real-response.json)
 * and caught three defects that hand-written stubs did not:
 *
 *   1. `status` is the string "Finished Airing", so a substring test for
 *      "airing" classified every completed series as still releasing.
 *   2. `trailer.youtube_id` is null in practice while the id is present in
 *      `trailer.embed_url`, so no title ever produced a trailer.
 *   3. Movies carry `year: null` / `season: null` and expose the air date only
 *      under `aired.prop.from.year`.
 *
 * If Jikan changes shape, re-record the fixture rather than loosening these.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mapJikanAnime } from '../lib/anime/jikan';
import fixtureJson from './fixtures/jikan-real-response.json';

type JikanRecord = Parameters<typeof mapJikanAnime>[0];

const fixture = fixtureJson as unknown as {
  topAnime: { data: JikanRecord[] };
  singleAnime: { data: JikanRecord };
};

const [frieren, reZero] = fixture.topAnime.data;
const spiritedAway = fixture.singleAnime.data;

test('a finished series is not reported as still releasing', () => {
  // "Finished Airing".includes("airing") === true - the original trap.
  assert.equal(frieren.status, 'Finished Airing');
  assert.equal(mapJikanAnime(frieren).status, 'FINISHED');
});

test('a currently airing series is reported as releasing', () => {
  assert.equal(reZero.status, 'Currently Airing');
  assert.equal(mapJikanAnime(reZero).status, 'RELEASING');
});

test('a trailer id is recovered from embed_url when youtube_id is null', () => {
  assert.equal(frieren.trailer?.youtube_id, null);
  const mapped = mapJikanAnime(frieren);
  assert.equal(mapped.trailer?.site, 'youtube');
  assert.equal(mapped.trailer?.id, 'ZEkwCGJ3o7M');
  assert.equal(mapped.trailer?.url, 'https://www.youtube.com/watch?v=ZEkwCGJ3o7M');
});

test('a movie falls back to the air date when year and season are null', () => {
  assert.equal(spiritedAway.year, null);
  assert.equal(spiritedAway.season, null);
  const mapped = mapJikanAnime(spiritedAway);
  assert.equal(mapped.year, 2001);
  assert.equal(mapped.season, null);
  assert.equal(mapped.format, 'MOVIE');
});

test('a real record maps onto the normalized summary the UI consumes', () => {
  const mapped = mapJikanAnime(frieren);
  assert.equal(mapped.id, 'mal:52991');
  assert.equal(mapped.malId, 52991);
  assert.equal(mapped.anilistId, null);
  assert.equal(mapped.title, "Frieren: Beyond Journey's End");
  assert.equal(mapped.titles.romaji, 'Sousou no Frieren');
  assert.equal(mapped.titles.native, '葬送のフリーレン');
  assert.equal(mapped.slug, 'sousou-no-frieren');
  assert.equal(mapped.format, 'TV');
  assert.equal(mapped.episodeCount, 28);
  assert.equal(mapped.year, 2023);
  assert.equal(mapped.season, 'FALL');
  assert.equal(mapped.durationMinutes, 24);
  // Jikan scores are 0-10; the UI works in AniList's 0-100 space.
  assert.equal(mapped.averageScore, 93);
  assert.deepEqual(mapped.studios, ['Madhouse']);
  assert.deepEqual(mapped.genres, ['Adventure', 'Award Winning', 'Drama', 'Fantasy']);
  assert.equal(mapped.coverImage, 'https://cdn.myanimelist.net/images/anime/1015/138006l.jpg');
  assert.equal(mapped.isAdult, false);
  assert.equal(mapped.source, 'jikan');
});

test('a mature rating does not mark an ordinary title as adult', () => {
  // "R - 17+ (violence & profanity)" must not trip the adult filter; only
  // Rx/Hentai should. A stray match here would hide titles from the catalog.
  assert.match(reZero.rating ?? '', /^R - 17\+/);
  assert.equal(mapJikanAnime(reZero).isAdult, false);
});

test('a duration expressed in hours is converted to minutes', () => {
  assert.equal(spiritedAway.duration, '2 hr 4 min');
  assert.equal(mapJikanAnime(spiritedAway).durationMinutes, 124);
});
