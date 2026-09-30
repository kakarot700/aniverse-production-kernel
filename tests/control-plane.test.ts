import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getControlPlane,
  ingestCmcdReport,
  recordMirrorOutcome,
  resetControlPlane,
  snapshotControlPlane,
  toSteerableMirrors,
} from '../lib/streams/control-plane';
import { parseCmcd } from '../lib/streams/cmcd';
import { rankPathways, type SteerableMirror } from '../lib/streams/steering';

const NOW = 1_700_000_000_000;

const mirrors: SteerableMirror[] = [
  { id: 'a', priority: 100, pathwayId: 'a' },
  { id: 'b', priority: 200, pathwayId: 'b' },
];

test.beforeEach(() => resetControlPlane());

test('a report with no session id is ignored', () => {
  // Without `sid` there is nothing to correlate, and attributing it to a
  // shared bucket would let one client dominate the model.
  ingestCmcdReport(parseCmcd('bs,bl=0'), 'a', NOW);
  assert.equal(snapshotControlPlane(mirrors, NOW).activeSessions, 0);
});

test('a single report is not enough to move a pathway score', () => {
  // One viewer on hotel wifi is not a CDN outage.
  ingestCmcdReport(parseCmcd('sid="s1",bs,bl=0'), 'a', NOW);
  const snapshot = snapshotControlPlane(mirrors, NOW);
  assert.equal(snapshot.activeSessions, 1);
  assert.equal(snapshot.pathways[0].distress, 0, 'still below the two-report floor');
});

test('sustained starvation on one pathway raises its distress', () => {
  for (let index = 0; index < 5; index += 1) {
    ingestCmcdReport(parseCmcd('sid="s1",bs,bl=0'), 'a', NOW + index * 1000);
  }
  const snapshot = snapshotControlPlane(mirrors, NOW + 5000);
  assert.ok(snapshot.pathways[0].distress > 0.5, `expected distress, got ${snapshot.pathways[0].distress}`);
  assert.equal(snapshot.starvedSessions, 1);
});

test('a healthy client leaves distress at zero', () => {
  for (let index = 0; index < 5; index += 1) {
    ingestCmcdReport(parseCmcd('sid="s1",bl=30000,mtp=15000'), 'a', NOW + index * 1000);
  }
  assert.equal(snapshotControlPlane(mirrors, NOW + 5000).pathways[0].distress, 0);
});

test('distress demotes the pathway in the resulting steering order', () => {
  // The end-to-end point of the whole control plane.
  for (let index = 0; index < 8; index += 1) {
    ingestCmcdReport(parseCmcd(`sid="s${index}",bs,bl=0`), 'a', NOW + index * 100);
    ingestCmcdReport(parseCmcd(`sid="s${index}",bs,bl=0`), 'a', NOW + index * 100 + 10);
  }

  const { health, qoe } = getControlPlane();
  const ranked = rankPathways(mirrors, health, { now: NOW + 1000, distress: qoe.snapshot() });
  assert.equal(ranked[0], 'b', 'the healthy lower-priority pathway is promoted');
});

test('reports recover a pathway once clients stop starving', () => {
  for (let index = 0; index < 10; index += 1) {
    ingestCmcdReport(parseCmcd('sid="bad",bs,bl=0'), 'a', NOW + index * 100);
  }
  const hurt = snapshotControlPlane(mirrors, NOW + 1000).pathways[0].distress;

  for (let index = 0; index < 40; index += 1) {
    ingestCmcdReport(parseCmcd(`sid="ok${index}",bl=30000`), 'a', NOW + 2000 + index * 100);
    ingestCmcdReport(parseCmcd(`sid="ok${index}",bl=30000`), 'a', NOW + 2000 + index * 100 + 10);
  }
  const healed = snapshotControlPlane(mirrors, NOW + 8000).pathways[0].distress;

  assert.ok(healed < hurt, `expected recovery: ${hurt} -> ${healed}`);
});

test('an idle session is evicted rather than counted forever', () => {
  ingestCmcdReport(parseCmcd('sid="old",bl=30000'), 'a', NOW);
  assert.equal(snapshotControlPlane(mirrors, NOW).activeSessions, 1);

  // Six minutes later the session is past the idle window.
  ingestCmcdReport(parseCmcd('sid="new",bl=30000'), 'a', NOW + 6 * 60_000);
  const snapshot = snapshotControlPlane(mirrors, NOW + 6 * 60_000);
  assert.equal(snapshot.activeSessions, 1, 'the stale session is gone, not accumulated');
});

test('a returning session id after the idle window starts fresh', () => {
  for (let index = 0; index < 5; index += 1) {
    ingestCmcdReport(parseCmcd('sid="s1",bs,bl=0'), 'a', NOW + index * 100);
  }
  ingestCmcdReport(parseCmcd('sid="s1",bl=30000'), 'a', NOW + 10 * 60_000);

  const { sessions } = getControlPlane();
  assert.equal(sessions.get('s1')?.reports, 1, 'counters reset rather than resuming');
});

test('mirror outcomes feed the shared health book', () => {
  recordMirrorOutcome('a', false, 0, NOW);
  assert.equal(snapshotControlPlane(mirrors, NOW).pathways[0].coolingDown, true);

  recordMirrorOutcome('a', true, 42, NOW + 1);
  const snapshot = snapshotControlPlane(mirrors, NOW + 1);
  assert.equal(snapshot.pathways[0].coolingDown, false);
  assert.equal(snapshot.pathways[0].emaLatencyMs, 42);
});

test('steering and the client worker share one health book, so they cannot disagree', () => {
  recordMirrorOutcome('a', false, 0, NOW);
  const { health } = getControlPlane();
  const ranked = rankPathways(mirrors, health, { now: NOW });
  assert.equal(ranked[0], 'b');
});

test('registry servers map onto legal pathway ids and skip disabled ones', () => {
  const steerable = toSteerableMirrors([
    { id: 'reference mux', priority: 900 },
    { id: 'off-server', priority: 910, enabled: false },
    { id: 'ok-server', priority: 920, enabled: true },
  ]);

  assert.deepEqual(steerable.map((entry) => entry.pathwayId), ['reference-mux', 'ok-server']);
});

test('the snapshot stays bounded under many distinct sessions', () => {
  for (let index = 0; index < 400; index += 1) {
    ingestCmcdReport(parseCmcd(`sid="s${index}",bl=30000`), 'a', NOW + index);
  }
  const { sessions } = getControlPlane();
  assert.ok(sessions.size <= 5_000);
  assert.equal(snapshotControlPlane(mirrors, NOW + 400).activeSessions, sessions.size);
});

test('reports against an unknown pathway do not crash the snapshot', () => {
  ingestCmcdReport(parseCmcd('sid="s1",bs,bl=0'), 'ghost-pathway', NOW);
  ingestCmcdReport(parseCmcd('sid="s1",bs,bl=0'), 'ghost-pathway', NOW + 10);
  const snapshot = snapshotControlPlane(mirrors, NOW + 10);
  assert.equal(snapshot.pathways.length, 2);
  assert.equal(snapshot.totalReports, 2);
});
