import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocalPreviewUrl } from '../lib/preview-url';

test('accepts only simple same-origin WebM preview paths', () => {
  assert.equal(resolveLocalPreviewUrl('/previews/teaser.webm'), '/previews/teaser.webm');
  assert.equal(resolveLocalPreviewUrl('/previews/teaser-02.webm'), '/previews/teaser-02.webm');
});

test('keeps poster-only cards free of broken or remote preview requests', () => {
  assert.equal(resolveLocalPreviewUrl(undefined), undefined);
  assert.equal(resolveLocalPreviewUrl(''), undefined);
  assert.equal(resolveLocalPreviewUrl('https://cdn.example/teaser.webm'), undefined);
  assert.equal(resolveLocalPreviewUrl('/previews/../private.webm'), undefined);
  assert.equal(resolveLocalPreviewUrl('/previews/teaser.mp4'), undefined);
});
