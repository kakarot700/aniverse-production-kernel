import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCatalogQuery, catalogCacheKey, CATALOG_SORTS, SEASONS } from '../lib/anime/query';
import { formatLine, humanizeFormat, humanizeSeason, toPlainText } from '../lib/anime/text';
import { offlineBrowse, offlineDetail, offlineGenres, offlineAll } from '../lib/anime/offline';
import { TtlCache } from '../lib/anime/cache';
import { OFFLINE_SEED } from '../lib/anime/offline-seed';

test('catalog query parsing clamps every numeric input and falls back safely', () => {
  const query = parseCatalogQuery(new URLSearchParams('page=99999&perPage=9999&sort=nonsense&season=autumn&year=99'));
  assert.equal(query.page, 200, 'page is capped');
  assert.equal(query.perPage, 50, 'perPage is capped');
  assert.equal(query.sort, 'trending', 'unknown sort falls back');
  assert.equal(query.season, '', 'unknown season is dropped');
  assert.equal(query.year, null, 'out-of-range year is dropped');

  const negative = parseCatalogQuery(new URLSearchParams('page=-4&perPage=0'));
  assert.equal(negative.page, 1);
  assert.equal(negative.perPage, 1);
});

test('catalog query trims and bounds the free-text search term', () => {
  const long = 'x'.repeat(500);
  const query = parseCatalogQuery(new URLSearchParams(`q=%20%20${long}%20%20`));
  assert.equal(query.search.length, 120, 'search is bounded before reaching a third-party API');

  assert.equal(parseCatalogQuery(new URLSearchParams('q=+bleach+')).search, 'bleach');
});

test('every advertised sort value is accepted', () => {
  for (const sort of CATALOG_SORTS) {
    assert.equal(parseCatalogQuery(new URLSearchParams(`sort=${sort}`)).sort, sort);
  }
});

test('cache keys separate distinct queries and match identical ones', () => {
  const a = parseCatalogQuery(new URLSearchParams('q=bleach&page=2'));
  const b = parseCatalogQuery(new URLSearchParams('q=BLEACH&page=2'));
  const c = parseCatalogQuery(new URLSearchParams('q=bleach&page=3'));
  assert.equal(catalogCacheKey(a), catalogCacheKey(b), 'search is case-insensitive');
  assert.notEqual(catalogCacheKey(a), catalogCacheKey(c));
});

test('provider markup is reduced to readable plain text', () => {
  assert.equal(toPlainText('<i>Hello</i><br><br>World &amp; friends'), 'Hello World & friends');
  assert.equal(toPlainText('A synopsis. (Source: Some Site)'), 'A synopsis.');
  assert.equal(toPlainText('Body text [Written by MAL Rewrite]'), 'Body text');
  assert.equal(toPlainText('&#039;quoted&#039;'), "'quoted'");
  assert.equal(toPlainText(null), '');
  assert.equal(toPlainText(undefined), '');
});

test('plain text is truncated on a boundary with an ellipsis', () => {
  const result = toPlainText('a'.repeat(200), 50);
  assert.equal(result.length, 50);
  assert.ok(result.endsWith('…'));
});

test('format and season helpers produce display strings', () => {
  assert.equal(humanizeFormat('TV_SHORT'), 'TV Short');
  assert.equal(humanizeFormat(null), 'Series');
  assert.equal(formatLine('TV', 24), 'TV · 24 episodes');
  assert.equal(formatLine('TV', 1), 'TV · 1 episode');
  assert.equal(formatLine('MOVIE', 1), 'Film');
  assert.equal(formatLine('OVA', null), 'OVA');
  assert.equal(humanizeSeason('SUMMER', 2019), 'Summer 2019');
  assert.equal(humanizeSeason(null, 2019), '2019');
  assert.equal(humanizeSeason(null, null), '');
});

test('offline catalog is a real, complete dataset', () => {
  const all = offlineAll();
  assert.equal(all.length, OFFLINE_SEED.length);
  assert.ok(all.length >= 60, 'the offline fallback should be substantial');

  const ids = all.map((record) => record.id);
  assert.equal(new Set(ids).size, ids.length, 'offline ids must be unique');

  for (const record of all) {
    assert.match(record.id, /^offline:[a-z0-9-]+$/);
    assert.ok(record.title.length > 0);
    assert.ok(record.synopsis.length > 20);
    assert.ok(record.coverPoster.startsWith('/api/poster?'), 'artwork is generated locally, never hotlinked');
    assert.ok(record.genres.length > 0);
    assert.ok(record.year > 1900);
    assert.equal(record.source, 'offline');
    assert.ok(record.episodes.length > 0);
    assert.equal(record.episodes[0].mirrors.length, 0, 'mirrors are resolved per request, not baked in');
  }
});

test('offline browse paginates and reports whether more pages exist', () => {
  const first = offlineBrowse(parseCatalogQuery(new URLSearchParams('page=1&perPage=10')));
  assert.equal(first.items.length, 10);
  assert.equal(first.hasNextPage, true);
  assert.equal(first.source, 'offline');
  assert.equal(first.total, offlineAll().length);

  const second = offlineBrowse(parseCatalogQuery(new URLSearchParams('page=2&perPage=10')));
  assert.notEqual(first.items[0].id, second.items[0].id, 'pages must not repeat');

  const far = offlineBrowse(parseCatalogQuery(new URLSearchParams('page=200&perPage=10')));
  assert.equal(far.items.length, 0);
  assert.equal(far.hasNextPage, false);
});

test('offline search matches title, studio, and genre', () => {
  const byTitle = offlineBrowse(parseCatalogQuery(new URLSearchParams('q=cowboy')));
  assert.ok(byTitle.items.some((item) => item.title === 'Cowboy Bebop'));

  const byStudio = offlineBrowse(parseCatalogQuery(new URLSearchParams('q=ufotable')));
  assert.ok(byStudio.items.length > 0);
  assert.ok(byStudio.items.every((item) => (item.studios ?? []).join(' ').toLowerCase().includes('ufotable')));

  const none = offlineBrowse(parseCatalogQuery(new URLSearchParams('q=zzzznotarealtitle')));
  assert.equal(none.items.length, 0);
  assert.equal(none.total, 0);
});

test('offline filters compose: genre + format + sort', () => {
  const films = offlineBrowse(parseCatalogQuery(new URLSearchParams('format=MOVIE&sort=title')));
  assert.ok(films.items.length > 0);
  assert.ok(films.items.every((item) => item.mediaFormat === 'MOVIE'));
  const titles = films.items.map((item) => item.title);
  assert.deepEqual(titles, [...titles].sort((left, right) => left.localeCompare(right)));

  const drama = offlineBrowse(parseCatalogQuery(new URLSearchParams('genre=Drama&perPage=50')));
  assert.ok(drama.items.every((item) => item.genres.includes('Drama')));

  const newest = offlineBrowse(parseCatalogQuery(new URLSearchParams('sort=newest&perPage=5')));
  const years = newest.items.map((item) => item.year);
  assert.deepEqual(years, [...years].sort((left, right) => right - left));
});

test('offline detail resolves by id and rejects unknown ids', () => {
  const record = offlineBrowse(parseCatalogQuery(new URLSearchParams('perPage=1'))).items[0];
  assert.ok(record);
  assert.equal(offlineDetail(record.id)?.title, record.title);
  assert.equal(offlineDetail('offline:not-a-real-slug'), null);
});

test('offline genre vocabulary is sorted and deduplicated', () => {
  const genres = offlineGenres();
  assert.ok(genres.length > 10);
  assert.equal(new Set(genres).size, genres.length);
  assert.deepEqual(genres, [...genres].sort());
});

test('TTL cache expires entries and evicts the oldest past its cap', () => {
  const cache = new TtlCache<string>(1000, 2);
  cache.set('a', 'A', 0);
  assert.equal(cache.get('a', 500), 'A');
  assert.equal(cache.get('a', 1500), undefined, 'entry expires after its TTL');

  cache.set('x', 'X', 0);
  cache.set('y', 'Y', 0);
  cache.set('z', 'Z', 0);
  assert.equal(cache.size, 2, 'cache is bounded');
  assert.equal(cache.get('x', 10), undefined, 'oldest entry was evicted');
  assert.equal(cache.get('z', 10), 'Z');
});

test('catalog query accepts every season and pairs with a year', () => {
  for (const season of SEASONS) {
    const query = parseCatalogQuery(new URLSearchParams(`season=${season.toLowerCase()}&year=2019`));
    assert.equal(query.season, season, 'season is normalised to upper case');
    assert.equal(query.year, 2019);
  }
  assert.equal(parseCatalogQuery(new URLSearchParams('season=monsoon')).season, '');
});

test('offline browse ignores season rather than returning an empty grid', () => {
  // The seed has release years but no airing season. Silently returning zero
  // results would be indistinguishable from a broken filter.
  const withSeason = offlineBrowse(parseCatalogQuery(new URLSearchParams('season=SPRING&perPage=5')));
  assert.ok(withSeason.items.length > 0);
});

test('offline year filter is exact', () => {
  const page = offlineBrowse(parseCatalogQuery(new URLSearchParams('year=1998&perPage=50')));
  assert.ok(page.items.length > 0);
  assert.ok(page.items.every((item) => item.year === 1998));
});
