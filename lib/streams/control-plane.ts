/**
 * The server-side control plane.
 *
 * This is where the loop closes:
 *
 *      players ──CMCD──▶ ingest ──▶ health book + QoE book
 *                                          │
 *                                          ▼
 *      players ◀─Steering Manifest── rankPathways
 *
 * Clients report what they are actually experiencing via CMCD on every
 * segment request. That feeds a per-pathway distress model. The steering
 * endpoint then reorders pathways for *every* client, so one viewer hitting a
 * dying mirror protects the next viewer from it — which the old per-tab
 * failover memory could never do, because each browser tab had to rediscover
 * every failure for itself.
 *
 * Process-local on purpose. A single Next.js server instance is the unit of
 * memory here; the maps are bounded and everything decays, so there is no
 * unbounded growth and no cross-request leakage of anything identifying. In a
 * multi-instance deployment this would move to Redis, and the shape below is
 * deliberately a key/value model so that swap is a storage change rather than
 * a redesign.
 */

import { type MirrorHealthBook, createHealthBook, pruneHealthBook, recordFailure, recordSuccess } from './health';
import { PathwayQoeBook } from './qoe';
import { type ParsedCmcd, readDistress } from './cmcd';
import { type SteerableMirror, toPathwayId } from './steering';

/** How many distinct sessions to track before evicting the oldest. */
const MAX_SESSIONS = 5_000;

/** A session with no traffic for this long is considered over. */
const SESSION_IDLE_MS = 5 * 60_000;

interface SessionState {
  sessionId: string;
  pathwayId: string | null;
  lastSeenAt: number;
  reports: number;
  starvations: number;
  /** Rolling mean of the per-report distress readings. */
  meanDistress: number;
}

export interface ControlPlane {
  health: MirrorHealthBook;
  qoe: PathwayQoeBook;
  sessions: Map<string, SessionState>;
}

/**
 * Pinned to `globalThis`, not a module-level `let`.
 *
 * This is not defensive boilerplate — a plain module singleton genuinely does
 * not work here, and the failure is silent. Next.js bundles each route handler
 * separately, so `/api/steering` and `/api/servers` importing this file get
 * *different* module instances and therefore different control planes: the
 * steering endpoint reroutes correctly while the status endpoint reports all
 * zeros. Dev-mode recompiles discard the state on top of that.
 *
 * Verified by exactly that symptom before this was added. It is the same
 * pattern the Next.js docs prescribe for a database client.
 */
const PLANE_KEY = Symbol.for('aniverse.control-plane');

type PlaneGlobal = typeof globalThis & { [PLANE_KEY]?: ControlPlane };

export function getControlPlane(): ControlPlane {
  const store = globalThis as PlaneGlobal;
  store[PLANE_KEY] ??= { health: createHealthBook(), qoe: new PathwayQoeBook(), sessions: new Map() };
  return store[PLANE_KEY];
}

/** Test seam. */
export function resetControlPlane(): void {
  delete (globalThis as PlaneGlobal)[PLANE_KEY];
}

/**
 * Folds one CMCD report into the model.
 *
 * A single report is weak evidence — one viewer on hotel wifi is not a CDN
 * outage. So a report nudges a rolling mean rather than setting state
 * directly, and only a session that has reported repeatedly gets to move the
 * pathway's score. That is the difference between steering and thrashing.
 */
export function ingestCmcdReport(
  parsed: ParsedCmcd,
  pathwayId: string | null,
  now = Date.now(),
): void {
  const sessionId = typeof parsed.sid === 'string' ? parsed.sid : null;
  if (!sessionId) return;

  const { sessions, qoe } = getControlPlane();
  const distress = readDistress(parsed);

  let session = sessions.get(sessionId);
  if (!session || now - session.lastSeenAt > SESSION_IDLE_MS) {
    session = { sessionId, pathwayId, lastSeenAt: now, reports: 0, starvations: 0, meanDistress: 0 };
  }

  // Re-insert so the map's insertion order doubles as an LRU list.
  sessions.delete(sessionId);

  session.pathwayId = pathwayId ?? session.pathwayId;
  session.lastSeenAt = now;
  session.reports += 1;
  if (distress.starved) session.starvations += 1;
  session.meanDistress += (distress.severity - session.meanDistress) / session.reports;

  sessions.set(sessionId, session);

  // Two reports is the floor for contributing: enough to distinguish a
  // sustained problem from a single unlucky segment.
  if (session.pathwayId && session.reports >= 2) {
    qoe.record(session.pathwayId, Math.round((1 - session.meanDistress) * 100));
  }

  evictStaleSessions(now);
}

function evictStaleSessions(now: number): void {
  const { sessions } = getControlPlane();

  for (const [id, session] of sessions) {
    if (now - session.lastSeenAt <= SESSION_IDLE_MS) break; // Insertion order is age order.
    sessions.delete(id);
  }

  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done) break;
    sessions.delete(oldest.value);
  }
}

/** Records the outcome of a proxied fetch against the mirror that served it. */
export function recordMirrorOutcome(
  mirrorId: string,
  ok: boolean,
  latencyMs: number,
  now = Date.now(),
): void {
  const { health } = getControlPlane();
  if (ok) recordSuccess(health, mirrorId, latencyMs, now);
  else recordFailure(health, mirrorId, now);
  pruneHealthBook(health, now);
}

export interface ControlPlaneSnapshot {
  pathways: Array<{
    pathwayId: string;
    mirrorId: string;
    priority: number;
    distress: number;
    samples: number;
    coolingDown: boolean;
    emaLatencyMs: number | null;
  }>;
  activeSessions: number;
  totalReports: number;
  starvedSessions: number;
}

/** Operational view for `/api/servers` and the status page. */
export function snapshotControlPlane(
  mirrors: readonly SteerableMirror[],
  now = Date.now(),
): ControlPlaneSnapshot {
  const { health, qoe, sessions } = getControlPlane();

  let totalReports = 0;
  let starvedSessions = 0;
  let activeSessions = 0;
  for (const session of sessions.values()) {
    if (now - session.lastSeenAt > SESSION_IDLE_MS) continue;
    activeSessions += 1;
    totalReports += session.reports;
    if (session.starvations > 0) starvedSessions += 1;
  }

  return {
    pathways: mirrors.map((mirror) => {
      const record = health[mirror.id];
      return {
        pathwayId: mirror.pathwayId,
        mirrorId: mirror.id,
        priority: mirror.priority,
        distress: Number(qoe.distress(mirror.pathwayId).toFixed(3)),
        samples: qoe.sampleCount(mirror.pathwayId),
        coolingDown: Boolean(record && record.cooldownUntil > now),
        emaLatencyMs: record?.emaLatencyMs === null || record === undefined
          ? null
          : Math.round(record.emaLatencyMs),
      };
    }),
    activeSessions,
    totalReports,
    starvedSessions,
  };
}

/** Maps registry servers onto steerable pathways. */
export function toSteerableMirrors(
  servers: readonly { id: string; priority: number; enabled?: boolean }[],
): SteerableMirror[] {
  return servers
    .filter((server) => server.enabled !== false)
    .map((server) => ({ id: server.id, priority: server.priority, pathwayId: toPathwayId(server.id) }));
}
