import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NAV_DESTINATIONS,
  PRIMARY_DESTINATIONS,
  UTILITY_DESTINATIONS,
  activeDestination,
  isActivePath,
  pageTitle,
} from '../lib/nav';

test('the mobile tab bar stays within the four-to-five destination limit', () => {
  // More than five is a sign the IA is overloaded and it wrecks tap accuracy.
  assert.ok(PRIMARY_DESTINATIONS.length >= 3 && PRIMARY_DESTINATIONS.length <= 5);
});

test('every destination has a unique href and a label', () => {
  const hrefs = NAV_DESTINATIONS.map((item) => item.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(NAV_DESTINATIONS.every((item) => item.label.length > 0 && item.href.startsWith('/')));
});

test('primary and utility destinations partition the list', () => {
  assert.equal(PRIMARY_DESTINATIONS.length + UTILITY_DESTINATIONS.length, NAV_DESTINATIONS.length);
});

test('root is an exact match only', () => {
  // A naive prefix test would light Home up on literally every page.
  assert.equal(isActivePath('/', '/'), true);
  assert.equal(isActivePath('/', '/discover'), false);
  assert.equal(isActivePath('/', '/schedule'), false);
});

test('a destination matches itself', () => {
  assert.equal(isActivePath('/discover', '/discover'), true);
});

test('a destination matches its nested routes', () => {
  assert.equal(isActivePath('/discover', '/discover/action'), true);
  assert.equal(isActivePath('/discover', '/discover/action/2026'), true);
});

test('matching respects segment boundaries', () => {
  // The bug a plain startsWith always ships with.
  assert.equal(isActivePath('/settings', '/settings-old'), false);
  assert.equal(isActivePath('/search', '/searching'), false);
  assert.equal(isActivePath('/profile', '/profiles'), false);
});

test('a trailing slash does not change the match', () => {
  assert.equal(isActivePath('/discover', '/discover/'), true);
  assert.equal(isActivePath('/discover/', '/discover'), true);
  assert.equal(isActivePath('/', '/'), true);
});

test('query strings and hashes are ignored', () => {
  assert.equal(isActivePath('/search', '/search?q=naruto'), true);
  assert.equal(isActivePath('/discover', '/discover#top'), true);
  assert.equal(isActivePath('/', '/?ref=x'), true);
});

test('empty input never matches', () => {
  assert.equal(isActivePath('', '/discover'), false);
  assert.equal(isActivePath('/discover', ''), false);
});

test('the most specific destination wins', () => {
  assert.equal(activeDestination('/discover')?.href, '/discover');
  assert.equal(activeDestination('/settings')?.href, '/settings');
  assert.equal(activeDestination('/')?.href, '/');
});

test('an unknown route has no active destination', () => {
  assert.equal(activeDestination('/nowhere'), null);
  assert.equal(pageTitle('/nowhere'), 'Aniverse');
});

test('page titles come from the destination list', () => {
  assert.equal(pageTitle('/'), 'Home');
  assert.equal(pageTitle('/schedule'), 'Schedule');
  assert.equal(pageTitle('/profile'), 'My list');
});

test('exactly one primary destination is active for each primary route', () => {
  for (const destination of PRIMARY_DESTINATIONS) {
    const active = PRIMARY_DESTINATIONS.filter((item) => isActivePath(item.href, destination.href));
    assert.equal(active.length, 1, `${destination.href} lit up ${active.length} tabs`);
  }
});

test('short labels exist wherever the full label is long', () => {
  for (const destination of PRIMARY_DESTINATIONS) {
    const shown = destination.shortLabel ?? destination.label;
    assert.ok(shown.length <= 9, `"${shown}" will not fit in a tab bar`);
  }
});
