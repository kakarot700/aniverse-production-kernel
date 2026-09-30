/**
 * CMCD — Common Media Client Data (CTA-5004, version 1).
 *
 * CMCD is the industry standard for a player telling the delivery layer what
 * it is actually experiencing: how much buffer it has left, whether it just
 * starved, what throughput it is measuring, which rendition it picked. Players
 * emit it on every segment request; CDNs log it; operators finally get to
 * correlate "the CDN looked fine" with "the viewer was rebuffering".
 *
 * hls.js can already *emit* CMCD. What essentially nobody ships is the other
 * half — a server that *reads* it and does something. This module is both
 * directions, because the receiving side is what makes `/api/steering` able to
 * rank mirrors on real viewer distress instead of synthetic probes.
 *
 * Everything here is pure string work: no fetch, no DOM, no clock. That is
 * what makes a wire format testable against the specification rather than
 * against a running CDN.
 *
 * Spec: https://cdn.cta.tech/cta/media/media/resources/standards/pdfs/cta-5004-final.pdf
 */

/** Object being requested. Spec table 1, `ot`. */
export type CmcdObjectType = 'm' | 'a' | 'v' | 'av' | 'i' | 'c' | 'tt' | 'k' | 'o';

/** Streaming format, `sf`. d=DASH h=HLS s=Smooth o=other. */
export type CmcdStreamingFormat = 'd' | 'h' | 's' | 'o';

/** Stream type, `st`. v=VOD l=live. */
export type CmcdStreamType = 'v' | 'l';

export interface CmcdPayload {
  /** Encoded bitrate of the requested object, kbps. */
  br?: number;
  /** Buffer length, ms. Rounded to the nearest 100 on the wire. */
  bl?: number;
  /** Buffer starvation: the buffer ran dry since the last request. */
  bs?: boolean;
  /** Content id. Max 64 characters. */
  cid?: string;
  /** Object duration, ms. */
  d?: number;
  /** Deadline, ms. Rounded to the nearest 100 on the wire. */
  dl?: number;
  /** Measured throughput, kbps. Rounded to the nearest 100 on the wire. */
  mtp?: number;
  /** Next object request, a relative URL. */
  nor?: string;
  /** Next range request, `"<start>-<end>"`. */
  nrr?: string;
  /** Object type. */
  ot?: CmcdObjectType;
  /** Playback rate. 1 is the default and is omitted. */
  pr?: number;
  /** Requested maximum throughput, kbps. Rounded to the nearest 100. */
  rtp?: number;
  /** Streaming format. */
  sf?: CmcdStreamingFormat;
  /** Session id (GUID). Max 64 characters. */
  sid?: string;
  /** Stream type. */
  st?: CmcdStreamType;
  /** Startup: this object is needed urgently (start, seek, or post-rebuffer). */
  su?: boolean;
  /** Top bitrate available to the client, kbps. */
  tb?: number;
  /** Spec version. Only serialized when != 1. */
  v?: number;
  /** Custom keys. MUST carry a hyphenated, reverse-DNS-style prefix. */
  custom?: Record<string, string | number | boolean>;
}

/**
 * Which header each reserved key belongs to, by expected variability. Used
 * only in header mode; the spec shards keys so HPACK/QPACK can compress the
 * invariant ones once per connection instead of once per segment.
 */
export const CMCD_HEADER_MAP = {
  // Vary per object.
  br: 'CMCD-Object', d: 'CMCD-Object', ot: 'CMCD-Object', tb: 'CMCD-Object',
  // Vary per request.
  bl: 'CMCD-Request', dl: 'CMCD-Request', mtp: 'CMCD-Request',
  nor: 'CMCD-Request', nrr: 'CMCD-Request', su: 'CMCD-Request',
  // Vary occasionally.
  bs: 'CMCD-Status', rtp: 'CMCD-Status',
  // Invariant for the session.
  cid: 'CMCD-Session', pr: 'CMCD-Session', sf: 'CMCD-Session',
  sid: 'CMCD-Session', st: 'CMCD-Session', v: 'CMCD-Session',
} as const satisfies Record<string, CmcdHeaderName>;

export type CmcdHeaderName = 'CMCD-Object' | 'CMCD-Request' | 'CMCD-Status' | 'CMCD-Session';

export const CMCD_QUERY_KEY = 'CMCD';

/** Keys the spec requires to be rounded to the nearest 100 to blunt fingerprinting. */
const ROUNDED_TO_100 = new Set(['bl', 'dl', 'mtp', 'rtp']);

/** Keys whose values are tokens, which must NOT be quoted. */
const TOKEN_KEYS = new Set(['ot', 'sf', 'st']);

const MAX_ID_LENGTH = 64;

function roundTo100(value: number): number {
  return Math.round(value / 100) * 100;
}

/** Quotes and escapes per spec item 7: `"` and `\` are backslash-escaped. */
export function quoteCmcdString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Numbers must not serialize in exponential notation — `1e+21` is not a valid
 * structured-field integer and a receiving CDN would drop the whole pair.
 */
function serializeNumber(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1000) / 1000;
  if (Math.abs(rounded) >= 1e21) return null;
  return String(rounded);
}

function serializeValue(key: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value === 'boolean') {
    // Item 2: a TRUE boolean is the bare key; FALSE is omitted entirely.
    return value ? '' : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const scaled = ROUNDED_TO_100.has(key) ? roundTo100(value) : value;
    return serializeNumber(scaled);
  }

  if (typeof value === 'string') {
    if (value.length === 0) return null;
    // Tokens go bare; everything else -- including unknown/custom keys -- is
    // quoted, which is the safe default under the structured-field grammar.
    return TOKEN_KEYS.has(key) ? value : quoteCmcdString(value);
  }

  return null;
}

/** Drops values the spec would reject, so a bad caller cannot emit a bad payload. */
function normalize(payload: CmcdPayload): Array<[string, unknown]> {
  const pairs: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'custom' || value === undefined || value === null) continue;

    // Negative buffer/bitrate/throughput is meaningless; sending it would
    // poison a CDN's analytics rather than merely being ignored.
    if (typeof value === 'number' && value < 0) continue;

    // `v=1` is the default and MUST NOT be sent.
    if (key === 'v' && value === 1) continue;

    // `pr=1` is normal-speed playback and is likewise redundant.
    if (key === 'pr' && value === 1) continue;

    if ((key === 'cid' || key === 'sid') && typeof value === 'string' && value.length > MAX_ID_LENGTH) {
      pairs.push([key, value.slice(0, MAX_ID_LENGTH)]);
      continue;
    }

    pairs.push([key, value]);
  }

  for (const [key, value] of Object.entries(payload.custom ?? {})) {
    // Item 4/5: custom keys must be namespaced, or they risk colliding with a
    // future reserved key. Silently dropping is safer than emitting garbage.
    if (!key.includes('-')) continue;
    pairs.push([key, value]);
  }

  return pairs;
}

/**
 * Serializes to the raw comma-separated payload, keys in alphabetical order
 * (item 9 — a fixed order reduces the fingerprinting surface a player exposes).
 * Not URL-encoded: that is the caller's job, and only in query mode.
 */
export function serializeCmcd(payload: CmcdPayload): string {
  const parts: string[] = [];

  for (const [key, value] of normalize(payload).sort((left, right) => left[0].localeCompare(right[0]))) {
    const serialized = serializeValue(key, value);
    if (serialized === null) continue;
    parts.push(serialized === '' ? key : `${key}=${serialized}`);
  }

  return parts.join(',');
}

/** Appends `CMCD=<urlencoded>` to a URL, preserving any existing query string. */
export function appendCmcdToUrl(url: string, payload: CmcdPayload): string {
  const serialized = serializeCmcd(payload);
  if (!serialized) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${CMCD_QUERY_KEY}=${encodeURIComponent(serialized)}`;
}

/**
 * Header mode. Sharded per the spec so invariant session keys compress well.
 * Custom keys land in CMCD-Session: they are ours, and ours do not vary
 * per-request.
 */
export function cmcdHeaders(payload: CmcdPayload): Partial<Record<CmcdHeaderName, string>> {
  const buckets = new Map<CmcdHeaderName, string[]>();

  for (const [key, value] of normalize(payload).sort((left, right) => left[0].localeCompare(right[0]))) {
    const serialized = serializeValue(key, value);
    if (serialized === null) continue;
    const header = (CMCD_HEADER_MAP as Record<string, CmcdHeaderName>)[key] ?? 'CMCD-Session';
    const list = buckets.get(header) ?? [];
    list.push(serialized === '' ? key : `${key}=${serialized}`);
    buckets.set(header, list);
  }

  const headers: Partial<Record<CmcdHeaderName, string>> = {};
  for (const [header, list] of buckets) headers[header] = list.join(',');
  return headers;
}

// ───────────────────────────── receiving side ─────────────────────────────

export type CmcdValue = string | number | boolean;
export type ParsedCmcd = Record<string, CmcdValue>;

/**
 * Splits on commas that are not inside a quoted string. A naive `split(',')`
 * corrupts any value containing a comma — and `nor` is a URL, so that is not
 * a hypothetical.
 */
function splitTopLevel(payload: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;

  for (const char of payload) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && inQuotes) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === ',' && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

function unquote(raw: string): string {
  const inner = raw.slice(1, -1);
  let out = '';
  let escaped = false;
  for (const char of inner) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    out += char;
  }
  return out;
}

/**
 * Parses a CMCD payload from a query argument or header value.
 *
 * Deliberately lenient in exactly the way the spec demands of servers
 * (section 5): unknown keys are kept rather than rejected, malformed pairs are
 * skipped rather than throwing. A player sending one bad key must not cost us
 * the other fifteen good ones.
 */
export function parseCmcd(payload: string | null | undefined): ParsedCmcd {
  const result: ParsedCmcd = {};
  if (!payload) return result;

  for (const chunk of splitTopLevel(payload)) {
    const part = chunk.trim();
    if (!part) continue;

    const equals = part.indexOf('=');
    if (equals === -1) {
      // A bare key is a TRUE boolean.
      if (/^[\w.\-]+$/.test(part)) result[part] = true;
      continue;
    }

    const key = part.slice(0, equals).trim();
    const raw = part.slice(equals + 1).trim();
    if (!key || !raw) continue;

    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      result[key] = unquote(raw);
      continue;
    }
    if (raw === 'true' || raw === 'false') {
      result[key] = raw === 'true';
      continue;
    }
    // Reject `Infinity`, `NaN`, `0x10` and other things `Number()` accepts but
    // the structured-field grammar does not.
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      result[key] = Number(raw);
      continue;
    }
    result[key] = raw;
  }

  return result;
}

/** Pulls CMCD out of a request, checking the query argument then all four headers. */
export function extractCmcd(url: URL, headers: Headers): ParsedCmcd {
  const fromQuery = url.searchParams.get(CMCD_QUERY_KEY);
  if (fromQuery) return parseCmcd(fromQuery);

  const merged: ParsedCmcd = {};
  for (const header of ['CMCD-Object', 'CMCD-Request', 'CMCD-Status', 'CMCD-Session'] as const) {
    Object.assign(merged, parseCmcd(headers.get(header)));
  }
  return merged;
}

/** Removes CMCD from a URL so it never becomes part of a cache key. */
export function stripCmcd(url: URL): URL {
  const copy = new URL(url.toString());
  copy.searchParams.delete(CMCD_QUERY_KEY);
  return copy;
}

/**
 * The distress read: is this client actually in trouble right now?
 *
 * `bs` (the buffer ran dry) is unambiguous. A low `bl` is the leading
 * indicator — by the time `bs` arrives the viewer has already seen a spinner,
 * so steering that waits for `bs` is steering that is always too late.
 */
export interface CmcdDistress {
  starved: boolean;
  bufferMs: number | null;
  throughputKbps: number | null;
  /** 0 = healthy, 1 = actively starving. */
  severity: number;
}

/** Below this buffer a client is one hiccup from stalling. */
export const LOW_BUFFER_MS = 4_000;

export function readDistress(parsed: ParsedCmcd): CmcdDistress {
  const starved = parsed.bs === true;
  const bufferMs = typeof parsed.bl === 'number' ? parsed.bl : null;
  const throughputKbps = typeof parsed.mtp === 'number' ? parsed.mtp : null;

  let severity = 0;
  if (starved) {
    severity = 1;
  } else if (bufferMs !== null && bufferMs < LOW_BUFFER_MS) {
    // Linear ramp: a full low-buffer window is mild, an empty one is severe.
    severity = Math.min(1, Math.max(0, (LOW_BUFFER_MS - bufferMs) / LOW_BUFFER_MS)) * 0.8;
  }

  return { starved, bufferMs, throughputKbps, severity };
}
