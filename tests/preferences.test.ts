import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PLAYBACK_SETTINGS,
  parsePlaybackSettings,
} from '../lib/user-data/settings';
import { mergeRecent, parseRecent } from '../lib/user-data/recent-searches';
import {
  THEME_BOOTSTRAP,
  parseThemePreference,
  resolveTheme,
  themeAttribute,
} from '../lib/theme';

/* ── theme ─────────────────────────────────────────────────────────── */

test('an unknown stored theme falls back to following the system', () => {
  assert.equal(parseThemePreference('dark'), 'dark');
  assert.equal(parseThemePreference('light'), 'light');
  assert.equal(parseThemePreference('system'), 'system');
  assert.equal(parseThemePreference('midnight'), 'system');
  assert.equal(parseThemePreference(null), 'system');
  assert.equal(parseThemePreference(undefined), 'system');
  assert.equal(parseThemePreference(7), 'system');
});

test('an explicit theme overrides the system signal', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('system follows the OS in both directions', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('system sets no attribute so CSS can keep tracking the OS', () => {
  // If `system` wrote an attribute, a device flipping to dark at sunset
  // would be ignored until the page was reloaded.
  assert.equal(themeAttribute('system'), null);
  assert.equal(themeAttribute('dark'), 'dark');
  assert.equal(themeAttribute('light'), 'light');
});

test('the inline theme bootstrap is self-contained and cannot throw', () => {
  // It runs before anything else in <head>; a throw would leave the page
  // unstyled, and a syntax error would take the document with it.
  assert.match(THEME_BOOTSTRAP, /^\(function\(\)\{try\{/);
  assert.match(THEME_BOOTSTRAP, /catch\(e\)\{\}/);
  assert.ok(!THEME_BOOTSTRAP.includes('</script'), 'must not be able to close its own tag');
  // Parses as JavaScript.
  assert.doesNotThrow(() => new Function(THEME_BOOTSTRAP));
});

/* ── playback settings ─────────────────────────────────────────────── */

test('absent settings produce the documented defaults', () => {
  assert.deepEqual(parsePlaybackSettings(null), DEFAULT_PLAYBACK_SETTINGS);
  assert.deepEqual(parsePlaybackSettings(undefined), DEFAULT_PLAYBACK_SETTINGS);
  assert.deepEqual(parsePlaybackSettings('nonsense'), DEFAULT_PLAYBACK_SETTINGS);
});

test('adaptive quality is the default, not highest', () => {
  // Highest-first starts slower and stalls more; it has to be opted into.
  assert.equal(DEFAULT_PLAYBACK_SETTINGS.preferHighestQuality, false);
});

test('a partial blob keeps its valid fields instead of resetting everything', () => {
  // This is what a settings object written by an older build looks like.
  const parsed = parsePlaybackSettings({ autoplayNext: false });
  assert.equal(parsed.autoplayNext, false, 'the stored choice survives');
  assert.equal(parsed.autoSkipIntro, DEFAULT_PLAYBACK_SETTINGS.autoSkipIntro);
  assert.equal(parsed.seekStepSeconds, DEFAULT_PLAYBACK_SETTINGS.seekStepSeconds);
});

test('wrongly typed fields fall back individually', () => {
  const parsed = parsePlaybackSettings({
    autoplayNext: 'yes',
    gesturesEnabled: false,
    seekStepSeconds: '10',
  });
  assert.equal(parsed.autoplayNext, true, 'string is not a boolean');
  assert.equal(parsed.gesturesEnabled, false, 'a real boolean is kept');
  assert.equal(parsed.seekStepSeconds, 10, 'string is not a number');
});

test('the seek step is restricted to offered values', () => {
  assert.equal(parsePlaybackSettings({ seekStepSeconds: 5 }).seekStepSeconds, 5);
  assert.equal(parsePlaybackSettings({ seekStepSeconds: 30 }).seekStepSeconds, 30);
  assert.equal(parsePlaybackSettings({ seekStepSeconds: 9999 }).seekStepSeconds, 10);
  assert.equal(parsePlaybackSettings({ seekStepSeconds: -10 }).seekStepSeconds, 10);
});

/* ── recent searches ───────────────────────────────────────────────── */

test('the newest search goes first', () => {
  assert.deepEqual(mergeRecent(['b', 'c'], 'a'), ['a', 'b', 'c']);
});

test('repeating a search moves it up rather than duplicating it', () => {
  assert.deepEqual(mergeRecent(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
});

test('de-duplication ignores case but keeps the newest spelling', () => {
  assert.deepEqual(mergeRecent(['naruto'], 'Naruto'), ['Naruto']);
  assert.deepEqual(mergeRecent(['NARUTO', 'bleach'], 'naruto'), ['naruto', 'bleach']);
});

test('the list is bounded so it cannot grow without limit', () => {
  const many = Array.from({ length: 40 }, (_, index) => `term-${index}`);
  assert.equal(mergeRecent(many, 'new').length, 8);
  assert.equal(mergeRecent(many, 'new')[0], 'new');
});

test('blank input is ignored but still trims the list', () => {
  assert.deepEqual(mergeRecent(['a'], '   '), ['a']);
  assert.deepEqual(mergeRecent(['a'], ''), ['a']);
});

test('stored junk never reaches the UI', () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent('a string'), []);
  assert.deepEqual(parseRecent([1, null, 'ok', '  ', { a: 1 }]), ['ok']);
});

test('an over-long term is truncated rather than rejected', () => {
  const long = 'x'.repeat(500);
  const [first] = mergeRecent([], long);
  assert.equal(first.length, 80);
});
