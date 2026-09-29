import assert from 'node:assert/strict';
import test from 'node:test';
import { TtlCache } from '../lib/anime/cache';

test('values expire once the TTL passes', async () => {
  const cache = new TtlCache<string>(20);
  cache.set('a', 'value');
  assert.equal(cache.get('a'), 'value');
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(cache.get('a'), undefined);
});

test('concurrent misses collapse into a single upstream call', async () => {
  const cache = new TtlCache<number>(1_000);
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return 42;
  };

  const results = await Promise.all([
    cache.resolve('key', loader),
    cache.resolve('key', loader),
    cache.resolve('key', loader),
  ]);

  assert.deepEqual(results, [42, 42, 42]);
  assert.equal(calls, 1);
  assert.equal(await cache.resolve('key', loader), 42);
  assert.equal(calls, 1);
});

test('a failed load is not cached and does not wedge later attempts', async () => {
  const cache = new TtlCache<string>(1_000);
  await assert.rejects(cache.resolve('k', async () => { throw new Error('boom'); }));
  assert.equal(await cache.resolve('k', async () => 'recovered'), 'recovered');
});

test('the cache evicts the oldest entry instead of growing without bound', () => {
  const cache = new TtlCache<number>(1_000, 3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  // Touch "a" so "b" becomes the eviction candidate.
  assert.equal(cache.get('a'), 1);
  cache.set('d', 4);
  assert.equal(cache.size, 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('d'), 4);
});
