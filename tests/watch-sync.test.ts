import assert from 'node:assert/strict';
import test from 'node:test';
import { estimatePeerClockOffset, planPlaybackCorrection, predictPlayheadSeconds } from '../lib/watch-sync';

test('four-timestamp clock sample estimates peer offset and round-trip time', () => {
  const estimate = estimatePeerClockOffset({ localSentAt: 1000, peerReceivedAt: 1060, peerSentAt: 1065, localReceivedAt: 1015 });
  assert.equal(estimate.offsetMs, 55);
  assert.equal(estimate.rttMs, 10);
});

test('playhead prediction compensates for message age only while remote playback is active', () => {
  const snapshot = { peerId: 'peer-a', sequence: 1, positionMs: 12_000, playing: true, sentAt: 5000 };
  assert.equal(predictPlayheadSeconds(snapshot, 6000, 50), 13.05);
  assert.equal(predictPlayheadSeconds({ ...snapshot, playing: false }, 6000, 50), 12);
});

test('drift within the 10 ms target tolerance does not cause a correction', () => {
  const correction = planPlaybackCorrection(1, 1.009, true);
  assert.equal(correction.kind, 'none');
  if (correction.kind === 'none') assert.ok(Math.abs(correction.driftMs - 9) < 0.001);
});

test('small drift uses a bounded playback-rate adjustment, larger drift seeks', () => {
  const gentle = planPlaybackCorrection(10, 10.05, true);
  assert.equal(gentle.kind, 'rate');
  if (gentle.kind === 'rate') assert.ok(gentle.playbackRate > 1 && gentle.playbackRate <= 1.03);

  const large = planPlaybackCorrection(10, 10.5, true);
  assert.equal(large.kind, 'seek');
  if (large.kind === 'seek') assert.equal(large.targetSeconds, 10.5);
});
