import assert from 'node:assert/strict';
import test from 'node:test';
import { offlineCatalogPage, offlineDetail, offlineLibrary } from '../lib/anime/offline';
import type { CatalogQuery } from '../types/anime';

function query(overrides: Partial<CatalogQuery> = {}): CatalogQuery {
  return {
    mode: 'trending',
    search: '',
    genre: '',
    format: '',
    season: '',
    year: null,
    page: 1,
    perPage: 24,
    ...overrides,
  };
}

test('every offline record is self-contained and served from bundled artwork', () => {
  assert.ok(offlineLibrary.length >= 5);
  const ids = new Set<string>();
  for (const item of offlineLibrary) {
    assert.ok(item.coverImage.startsWith('/posters/'), `${item.id} must use a bundled poster`);
    assert.equal(item.source, 'offline');
    assert.equal(item.isAdult, false);
    assert.ok(item.synopsis.length > 20);
    assert.ok(item.genres.length > 0);
    assert.equal(ids.has(item.id), false, 'offline ids must be unique');
    ids.add(item.id);
  }
});

test('offline pages always report the degraded flag and a notice', () => {
  const page = offlineCatalogPage(query());
  assert.equal(page.degraded, true);
  assert.ok(page.notice && page.notice.length > 0);
  assert.equal(page.source, 'offline');
  assert.equal(page.items.length, offlineLibrary.length);
});

test('offline filtering honours search, genre, format and year', () => {
  assert.ok(offlineCatalogPage(query({ search: 'lighthouse' })).items.length >= 1);
  assert.equal(offlineCatalogPage(query({ search: 'no-such-title-anywhere' })).items.length, 0);
  assert.ok(offlineCatalogPage(query({ genre: 'fantasy' })).items.every((item) =>
    item.genres.some((genre) => genre.toLowerCase() === 'fantasy')));
  assert.ok(offlineCatalogPage(query({ format: 'MOVIE' })).items.every((item) => item.format === 'MOVIE'));
  assert.ok(offlineCatalogPage(query({ year: 2024 })).items.every((item) => item.year === 2024));
});

test('offline pagination reports an accurate lastPage and hasNextPage', () => {
  const first = offlineCatalogPage(query({ perPage: 2, page: 1 }));
  assert.equal(first.items.length, 2);
  assert.equal(first.pageInfo.hasNextPage, true);
  assert.equal(first.pageInfo.total, offlineLibrary.length);

  const last = offlineCatalogPage(query({ perPage: 2, page: first.pageInfo.lastPage }));
  assert.equal(last.pageInfo.hasNextPage, false);
  assert.ok(last.items.length > 0);

  const beyond = offlineCatalogPage(query({ perPage: 2, page: 99 }));
  assert.equal(beyond.items.length, 0);
});

test('offline details expand a complete, numbered episode list', () => {
  const series = offlineDetail('offline:clouds-rest');
  assert.ok(series);
  assert.equal(series.episodes.length, series.episodeCount);
  assert.deepEqual(
    series.episodes.map((episode) => episode.number).slice(0, 3),
    [1, 2, 3],
  );
  assert.ok(series.episodes.every((episode) => episode.aired));

  const film = offlineDetail('offline:tideglass');
  assert.ok(film);
  assert.equal(film.episodes.length, 1);
  assert.equal(film.episodes[0].title, 'Feature');

  assert.equal(offlineDetail('offline:does-not-exist'), null);
});

test('offline details are also reachable by slug', () => {
  assert.equal(offlineDetail('a-moon-above-the-quiet-sea')?.id, 'offline:moon-tide');
});
