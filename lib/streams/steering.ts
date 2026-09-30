/**
 * HLS Content Steering (RFC 8216bis §7 / Apple Content Steering v1.2).
 *
 * This project already had multi-mirror failover — a bespoke worker racing
 * candidate URLs and remembering which ones hurt. Content Steering is the
 * *standardised* form of that exact idea: group redundant sources into
 * "Pathways", and let a steering server dynamically reprioritise them while
 * the player is running, with no reload and no lost buffer.
 *
 * Adopting it is not decoration. It means:
 *
 *   - Rerouting happens inside hls.js's own controller, mid-playback, instead
 *     of via a visible error-then-restart cycle.
 *   - Any conformant player — hls.js, Shaka, AVPlayer on iOS/tvOS, ExoPlayer —
 *     can consume our steering decisions without one line of bespoke client
 *     code.
 *   - The ranking logic moves server-side, where it can see every viewer's
 *     CMCD telemetry, instead of being trapped in one browser tab's memory.
 *
 * This module is the spec's data layer, in both directions: building manifests
 * (we are the steering server) and parsing them (we validate what we emit, and
 * can consume a third party's). Pure functions only.
 */

import { type MirrorHealthBook, isCoolingDown, scoreMirror, type ScorableMirror } from './health';

/** Pathway IDs are constrained to this set by the specification. */
const PATHWAY_ID_PATTERN = /^[a-zA-Z0-9.\-_]+$/;

/** The only Steering Manifest version this implementation understands. */
export const STEERING_VERSION = 1;

/** The spec's recommended reload interval. */
export const DEFAULT_TTL_SECONDS = 300;

/**
 * A steering server may vary TTL per client to spread load, but a TTL under a
 * second would have clients hammering the steering endpoint harder than the
 * media itself.
 */
export const MIN_TTL_SECONDS = 1;
export const MAX_TTL_SECONDS = 3600;

export interface UriReplacement {
  HOST?: string;
  PARAMS?: Record<string, string>;
  'PER-VARIANT-URIS'?: Record<string, string>;
  'PER-RENDITION-URIS'?: Record<string, string>;
}

export interface PathwayClone {
  ID: string;
  'BASE-ID': string;
  'URI-REPLACEMENT': UriReplacement;
}

export interface SteeringManifest {
  VERSION: number;
  TTL: number;
  'RELOAD-URI'?: string;
  'PATHWAY-PRIORITY': string[];
  'PATHWAY-CLONES'?: PathwayClone[];
}

export function isValidPathwayId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && PATHWAY_ID_PATTERN.test(id);
}

/**
 * Coerces an arbitrary mirror id into a legal Pathway ID.
 *
 * Our registry ids are freeform (`reference-mux-multibitrate`), and a steering
 * manifest carrying an illegal id is a manifest a conformant player will
 * ignore — silently. Sanitising at the boundary is cheaper than debugging a
 * player that just quietly refuses to steer.
 */
export function toPathwayId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9.\-_]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return cleaned.length > 0 ? cleaned : 'pathway';
}

export interface BuildSteeringOptions {
  ttlSeconds?: number;
  reloadUri?: string;
  clones?: PathwayClone[];
}

/**
 * Builds a spec-compliant Steering Manifest.
 *
 * Enforces the two rules that are easy to violate and hard to notice: a
 * Pathway ID must not appear twice, and there must be at least one pathway.
 * Invalid ids are dropped rather than emitted, because a conformant client
 * ignores them anyway and their presence only obscures the real priority.
 */
export function buildSteeringManifest(
  pathwayIds: readonly string[],
  options: BuildSteeringOptions = {},
): SteeringManifest {
  const seen = new Set<string>();
  const priority: string[] = [];

  for (const id of pathwayIds) {
    if (!isValidPathwayId(id) || seen.has(id)) continue;
    seen.add(id);
    priority.push(id);
  }

  if (priority.length === 0) {
    throw new Error('A Steering Manifest must contain at least one Pathway.');
  }

  const ttl = Math.min(
    MAX_TTL_SECONDS,
    Math.max(MIN_TTL_SECONDS, Math.round(options.ttlSeconds ?? DEFAULT_TTL_SECONDS)),
  );

  const manifest: SteeringManifest = {
    VERSION: STEERING_VERSION,
    TTL: ttl,
    'PATHWAY-PRIORITY': priority,
  };

  if (options.reloadUri) manifest['RELOAD-URI'] = options.reloadUri;

  if (options.clones?.length) {
    // A clone whose base is not a real pathway is meaningless, and a clone
    // colliding with an existing id would shadow it.
    const valid = options.clones.filter(
      (clone) => isValidPathwayId(clone.ID) && isValidPathwayId(clone['BASE-ID']),
    );
    if (valid.length > 0) manifest['PATHWAY-CLONES'] = valid;
  }

  return manifest;
}

/**
 * Resolves a RELOAD-URI, falling back to the current URI on anything suspect.
 *
 * Two traps here, both found by testing rather than by reading:
 *
 *   - `new URL('ht!tp://:::', base)` does NOT throw. An invalid scheme makes
 *     the whole string resolve as a *relative path*, yielding
 *     `https://base/api/ht!tp://:::`. So a try/catch alone silently accepts
 *     garbage and then reloads steering from a URL that 404s forever.
 *   - A steering manifest is a trust boundary the moment it comes from anyone
 *     but us. `javascript:` and `data:` resolve perfectly happily, and this
 *     value is destined for a fetch. The scheme must be checked, not assumed.
 *
 * So: anything that looks like it is trying to be absolute must parse as a
 * genuine absolute URL, and the final result must be http(s) either way.
 */
function resolveReloadUri(reloadUri: string | undefined, currentUri: string): string {
  if (!reloadUri) return currentUri;

  const looksAbsolute = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(reloadUri) || reloadUri.includes('://');

  try {
    if (looksAbsolute) {
      // Must stand on its own; if it cannot, it is malformed rather than relative.
      const absolute = new URL(reloadUri);
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return currentUri;
      return absolute.toString();
    }

    const resolved = new URL(reloadUri, currentUri);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return currentUri;
    return resolved.toString();
  } catch {
    return currentUri;
  }
}

export interface ParsedSteering {
  manifest: SteeringManifest;
  /** Absolute URI for the next reload, resolved against the current one. */
  nextUri: string;
  /** Epoch ms at which this manifest expires. */
  expiresAt: number;
}

/**
 * Parses and validates a Steering Manifest.
 *
 * Returns `null` rather than throwing on anything a conformant client must
 * refuse. The spec is explicit that a client MUST refuse an unrecognised
 * VERSION and MUST ignore unrecognised keys — the failure mode for a steering
 * manifest is "keep using the current pathway", never "stop playing".
 */
export function parseSteeringManifest(
  raw: unknown,
  currentUri: string,
  now = Date.now(),
): ParsedSteering | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  // MUST refuse a version we do not recognise. Note this rejects higher
  // versions specifically — a v2 manifest may use semantics we would
  // misinterpret, and misinterpreting steering is worse than not steering.
  if (typeof input.VERSION !== 'number' || !Number.isInteger(input.VERSION)) return null;
  if (input.VERSION > STEERING_VERSION) return null;

  if (typeof input.TTL !== 'number' || !Number.isFinite(input.TTL) || input.TTL <= 0) return null;

  const rawPriority = input['PATHWAY-PRIORITY'];
  if (!Array.isArray(rawPriority)) return null;

  const seen = new Set<string>();
  const priority: string[] = [];
  for (const id of rawPriority) {
    if (!isValidPathwayId(id) || seen.has(id)) continue;
    seen.add(id);
    priority.push(id);
  }
  if (priority.length === 0) return null;

  const manifest: SteeringManifest = {
    VERSION: input.VERSION,
    TTL: input.TTL,
    'PATHWAY-PRIORITY': priority,
  };

  if (typeof input['RELOAD-URI'] === 'string' && input['RELOAD-URI'].length > 0) {
    manifest['RELOAD-URI'] = input['RELOAD-URI'];
  }

  const rawClones = input['PATHWAY-CLONES'];
  if (Array.isArray(rawClones)) {
    const clones = rawClones.filter((clone): clone is PathwayClone => {
      if (!clone || typeof clone !== 'object') return false;
      const candidate = clone as Record<string, unknown>;
      return (
        isValidPathwayId(candidate.ID) &&
        isValidPathwayId(candidate['BASE-ID']) &&
        typeof candidate['URI-REPLACEMENT'] === 'object' &&
        candidate['URI-REPLACEMENT'] !== null
      );
    });
    if (clones.length > 0) manifest['PATHWAY-CLONES'] = clones;
  }

  const nextUri = resolveReloadUri(manifest['RELOAD-URI'], currentUri);
  if (!manifest['RELOAD-URI'] || nextUri === currentUri) delete manifest['RELOAD-URI'];

  return { manifest, nextUri, expiresAt: now + manifest.TTL * 1000 };
}

/**
 * Applies a Pathway Clone's URI-REPLACEMENT to one URI.
 *
 * Pathway cloning is the part of the spec that lets a steering server invent a
 * new CDN at runtime — swap the host, inject a fresh auth token — without the
 * multivariant playlist ever having mentioned it. That is genuinely powerful
 * and genuinely easy to get wrong: the replacement applies to host and query
 * only, never to the path.
 */
export function applyUriReplacement(uri: string, replacement: UriReplacement, stableId?: string): string {
  // A per-variant/per-rendition override replaces the whole URI and wins
  // outright over host/param surgery.
  if (stableId) {
    const perVariant = replacement['PER-VARIANT-URIS']?.[stableId];
    if (perVariant) return perVariant;
    const perRendition = replacement['PER-RENDITION-URIS']?.[stableId];
    if (perRendition) return perRendition;
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return uri;
  }

  if (replacement.HOST) {
    // Assigning `host` (not `hostname`) lets a replacement carry a port.
    parsed.host = replacement.HOST;
  }

  for (const [key, value] of Object.entries(replacement.PARAMS ?? {})) {
    // An empty value removes the parameter; that is how a steering server
    // revokes a token it previously injected.
    if (value === '') parsed.searchParams.delete(key);
    else parsed.searchParams.set(key, value);
  }

  return parsed.toString();
}

// ───────────────────────── health → priority bridge ─────────────────────────


export interface SteerableMirror extends ScorableMirror {
  pathwayId: string;
}

export interface RankPathwayOptions {
  now?: number;
  preferredId?: string | null;
  /**
   * Per-pathway viewer distress in [0,1], keyed by pathway id, derived from
   * CMCD reports. A pathway several viewers are starving on is demoted even
   * if our own synthetic probe of it looked fine.
   */
  distress?: Record<string, number>;
}

/**
 * Orders pathways best-first for a Steering Manifest.
 *
 * Reuses the existing health book so steering and the client-side worker can
 * never disagree about which mirror is healthy — there is one scoring
 * function, not two that drift apart.
 *
 * Distress is weighted heavily on purpose. A synthetic probe measures whether
 * a byte range returns in 40 ms; CMCD measures whether a real viewer on a real
 * connection is watching a spinner. When those disagree, the viewer is right.
 */
export function rankPathways(
  mirrors: readonly SteerableMirror[],
  book: MirrorHealthBook,
  options: RankPathwayOptions = {},
): string[] {
  const now = options.now ?? Date.now();
  const distress = options.distress ?? {};

  const scored = mirrors.map((mirror, index) => {
    let score = scoreMirror(mirror, book, now, options.preferredId);
    const pain = distress[mirror.pathwayId] ?? 0;
    // Up to a 2000-point penalty: enough to outrank any static priority gap,
    // short of the cooldown penalty which must still dominate.
    score += Math.min(1, Math.max(0, pain)) * 2_000;
    return { pathwayId: mirror.pathwayId, score, index };
  });

  const ordered = scored
    .sort((left, right) => (left.score === right.score ? left.index - right.index : left.score - right.score))
    .map((entry) => entry.pathwayId);

  // Dedupe while preserving order: several mirrors can share a pathway, but a
  // Pathway ID MUST NOT appear twice in PATHWAY-PRIORITY.
  const seen = new Set<string>();
  return ordered.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

/**
 * Chooses a TTL from how volatile the picture currently is.
 *
 * A steady system does not need clients checking in every five seconds, and a
 * degrading one cannot wait five minutes.
 *
 * Both signals count, which is not obvious: a mirror can be in *cooldown*
 * (our own probes failed) or merely under *distress* (probes pass, but real
 * viewers are starving on it). An earlier version looked only at cooldowns,
 * and a live test where twelve viewers reported starvation reordered the
 * pathways correctly while still telling every client to wait a full five
 * minutes before asking again -- the reroute was right and nobody heard about
 * it for five minutes.
 */
export function chooseTtlSeconds(
  mirrors: readonly SteerableMirror[],
  book: MirrorHealthBook,
  now = Date.now(),
  distress: Record<string, number> = {},
): number {
  if (mirrors.length === 0) return DEFAULT_TTL_SECONDS;

  const unstable = mirrors.filter(
    (mirror) => isCoolingDown(book, mirror.id, now) || (distress[mirror.pathwayId] ?? 0) >= 0.25,
  ).length;

  if (unstable === 0) return DEFAULT_TTL_SECONDS;
  if (unstable >= mirrors.length) return 10;
  return Math.max(15, Math.round(DEFAULT_TTL_SECONDS / (unstable + 1)));
}
