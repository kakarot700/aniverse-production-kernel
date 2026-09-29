/**
 * Operator source map: the trusted mapping from a catalog episode to the file
 * ids / manifest URLs that each configured server holds for it.
 *
 * Aniverse deliberately does not scrape or reverse-engineer third-party
 * players to discover these. You supply them, for content you are authorised
 * to distribute, either inline (`ANIVERSE_SOURCE_MAP_INLINE`) or from an https
 * endpoint you control (`ANIVERSE_SOURCE_MAP_URL`).
 *
 * Shape:
 *
 * ```json
 * {
 *   "version": 1,
 *   "entries": {
 *     "anilist:16498": {
 *       "1": [
 *         { "server": "aniverse-origin", "url": "https://cdn.example.com/aot/01/master.m3u8", "quality": "1080p", "audio": "sub" },
 *         { "server": "filemoon", "fileId": "k2m9xq1p", "quality": "720p" }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * `url` wins over `fileId`. `url` must be https. Unknown server ids are
 * ignored rather than failing the whole map.
 */

export interface SourceMapEntry {
  server: string;
  /** Provider-side file identifier, substituted into the server template. */
  fileId?: string;
  /** Fully-qualified https manifest/file URL. Takes precedence over `fileId`. */
  url?: string;
  quality?: string;
  audio?: 'sub' | 'dub' | 'raw';
}

export interface SourceMap {
  version: number;
  /** `mediaId -> episodeNumber -> entries` */
  entries: Record<string, Record<string, SourceMapEntry[]>>;
}

const EMPTY: SourceMap = { version: 1, entries: {} };

function isAudio(value: unknown): value is SourceMapEntry['audio'] {
  return value === 'sub' || value === 'dub' || value === 'raw';
}

function sanitizeEntry(value: unknown): SourceMapEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const server = typeof raw.server === 'string' ? raw.server.trim().toLowerCase() : '';
  if (!server) return null;

  const entry: SourceMapEntry = { server };

  if (typeof raw.url === 'string' && raw.url.trim()) {
    try {
      const url = new URL(raw.url.trim());
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      entry.url = url.toString();
    } catch {
      return null;
    }
  }

  // File ids are interpolated into URL templates, so keep them to an opaque,
  // path-safe character set. This prevents a malicious/typo'd map from
  // escaping the template and pointing at another origin.
  if (typeof raw.fileId === 'string') {
    const fileId = raw.fileId.trim();
    if (fileId && /^[A-Za-z0-9._~-]{1,128}$/.test(fileId)) entry.fileId = fileId;
  }

  if (!entry.url && !entry.fileId) return null;
  if (typeof raw.quality === 'string' && raw.quality.trim().length <= 16) entry.quality = raw.quality.trim();
  if (isAudio(raw.audio)) entry.audio = raw.audio;

  return entry;
}

export function sanitizeSourceMap(value: unknown): SourceMap {
  if (!value || typeof value !== 'object') return EMPTY;
  const raw = value as Record<string, unknown>;
  const rawEntries = raw.entries;
  if (!rawEntries || typeof rawEntries !== 'object') return EMPTY;

  const entries: SourceMap['entries'] = {};
  for (const [mediaId, episodesValue] of Object.entries(rawEntries as Record<string, unknown>)) {
    if (!episodesValue || typeof episodesValue !== 'object') continue;
    const episodes: Record<string, SourceMapEntry[]> = {};

    for (const [episodeKey, listValue] of Object.entries(episodesValue as Record<string, unknown>)) {
      if (!Array.isArray(listValue)) continue;
      const list = listValue.map(sanitizeEntry).filter((entry): entry is SourceMapEntry => entry !== null);
      if (list.length) episodes[String(episodeKey)] = list;
    }

    if (Object.keys(episodes).length) entries[mediaId] = episodes;
  }

  const version = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 1;
  return { version, entries };
}

export function lookupSourceMap(map: SourceMap, mediaId: string, episodeNumber: number): SourceMapEntry[] {
  return map.entries[mediaId]?.[String(episodeNumber)] ?? [];
}

// ── Runtime loading (server-side only) ──────────────────────────────────────

let cached: { map: SourceMap; expiresAt: number } | null = null;
const TTL_MS = 60_000;

export function clearSourceMapCache(): void {
  cached = null;
}

/**
 * Loads and caches the source map. Never throws: a broken or unreachable map
 * degrades to "no mappings", which surfaces in the UI as `unmapped` servers
 * rather than a crashed page.
 */
export async function loadSourceMap(
  config: { url: string | null; inline: string | null },
  now = Date.now(),
): Promise<SourceMap> {
  if (cached && cached.expiresAt > now) return cached.map;

  let map = EMPTY;

  if (config.inline) {
    try {
      map = sanitizeSourceMap(JSON.parse(config.inline));
    } catch {
      map = EMPTY;
    }
  }

  if (config.url) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(config.url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      clearTimeout(timeout);
      if (response.ok) {
        const remote = sanitizeSourceMap(await response.json());
        // Remote entries win over inline ones for the same media id.
        map = { version: remote.version, entries: { ...map.entries, ...remote.entries } };
      }
    } catch {
      // Keep whatever the inline map provided.
    }
  }

  cached = { map, expiresAt: now + TTL_MS };
  return map;
}
