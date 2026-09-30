/**
 * Stream-server definitions and the template engine that turns them into
 * per-episode endpoints.
 *
 * A "server" here is a real, addressable media origin that the operator is
 * allowed to stream from. Definitions are data, not code: the built-in list
 * below only contains public, openly published reference streams so a fresh
 * checkout can actually play video, and real content servers are supplied
 * through `ANIVERSE_STREAM_SERVERS` (see docs/STREAM-SERVERS.md).
 *
 * This module is isomorphic and has no Node dependencies so it can be unit
 * tested directly and imported from either runtime.
 */
import type { StreamKind, StreamLanguage, StreamMirrorNode } from '@/types/media';

export type ServerScope = 'universal' | 'mapped';

export type EpisodeTemplateMap = Record<string, Record<string, string>>;

export interface StreamServerDefinition {
  id: string;
  name: string;
  group: string;
  language: StreamLanguage;
  kind: StreamKind;
  /** Lower sorts first in the player's failover order. */
  priority: number;
  requiresProxy: boolean;
  /**
   * URL template. Supported tokens:
   * `{anilistId} {malId} {slug} {title} {year} {season} {episode} {episode2} {episode3}`
   */
  template: string;
  /**
   * `universal`  – the template resolves for any title in the catalog.
   * `mapped`     – only titles present in `titles` or `episodes` resolve.
   */
  scope: ServerScope;
  /** Per-title URL templates, keyed by an AniList/MAL id or slug. */
  titles?: Record<string, string>;
  /**
   * Exact per-episode URLs for CDNs whose playback ids are not predictable.
   * Shape: `{ "anilist:21": { "1": "https://…m3u8" } }`.
   */
  episodes?: EpisodeTemplateMap;
  quality?: string;
  note?: string;
  enabled: boolean;
  /** Public demo endpoint rather than licensed content. */
  isReference: boolean;
}

export interface TitleTokens {
  anilistId: number | null;
  malId: number | null;
  slug: string;
  title: string;
  year: number | null;
  season: string | null;
}

const TOKEN_PATTERN = /\{(anilistId|malId|slug|title|year|season|episode|episode2|episode3)\}/g;

/**
 * Publicly published reference streams.
 *
 * These are the industry-standard demo/test assets that their owners publish
 * for exactly this purpose (Mux and Apple developer test streams, plus the
 * Blender Foundation's CC-BY open movies hosted by Unified Streaming and
 * Bitmovin). They exist so playback, failover, the HLS proxy and watch-room
 * sync are all verifiable out of the box — they are not anime content, and the
 * UI labels them as reference streams.
 */
export const REFERENCE_SERVERS: StreamServerDefinition[] = [
  {
    id: 'reference-mux-multibitrate',
    name: 'Reference · Mux (multi-bitrate)',
    group: 'Reference',
    language: 'mixed',
    kind: 'hls',
    priority: 900,
    requiresProxy: true,
    template: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    scope: 'universal',
    quality: 'Adaptive',
    note: 'Mux public test stream (Big Buck Bunny, Blender Foundation, CC-BY).',
    enabled: true,
    isReference: true,
  },
  {
    id: 'reference-apple-fmp4',
    name: 'Reference · Apple fMP4',
    group: 'Reference',
    language: 'mixed',
    kind: 'hls',
    priority: 910,
    requiresProxy: true,
    template:
      'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    scope: 'universal',
    quality: 'Adaptive',
    note: 'Apple HLS advanced example stream (fMP4, multiple renditions and subtitles).',
    enabled: true,
    isReference: true,
  },
  {
    id: 'reference-unified-tears',
    name: 'Reference · Unified Streaming',
    group: 'Reference',
    language: 'mixed',
    kind: 'hls',
    priority: 920,
    requiresProxy: true,
    template:
      'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    scope: 'universal',
    quality: 'Adaptive',
    note: 'Unified Streaming demo (Tears of Steel, Blender Foundation, CC-BY).',
    enabled: true,
    isReference: true,
  },
  {
    id: 'reference-mux-single',
    name: 'Reference · Mux VOD',
    group: 'Reference',
    language: 'mixed',
    kind: 'hls',
    priority: 930,
    requiresProxy: true,
    template: 'https://stream.mux.com/v69RSHhFelSm4701snP22dYz2jICy4E4FUyk02rW4gxRM.m3u8',
    scope: 'universal',
    quality: 'Adaptive',
    note: 'Mux public VOD test asset.',
    enabled: true,
    isReference: true,
  },
  {
    id: 'reference-progressive-mp4',
    name: 'Reference · Progressive MP4',
    group: 'Reference',
    language: 'mixed',
    kind: 'mp4',
    priority: 940,
    requiresProxy: true,
    template: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    scope: 'universal',
    quality: '720p',
    note: 'Progressive MP4 fallback for browsers or networks where HLS fails.',
    enabled: true,
    isReference: true,
  },
];

export function padEpisode(episode: number, width: number): string {
  return String(Math.max(0, Math.trunc(episode))).padStart(width, '0');
}

/**
 * Tokens are always a single path/query component. Encoding `/` too means a
 * slug or title can never add path segments or traverse out of the location
 * the operator's template put it in.
 */
function encodeToken(value: string): string {
  return encodeURIComponent(value);
}

export function expandTemplate(template: string, tokens: TitleTokens, episode: number): string | null {
  let missing = false;
  const expanded = template.replace(TOKEN_PATTERN, (_match, token: string) => {
    switch (token) {
      case 'anilistId':
        if (tokens.anilistId == null) { missing = true; return ''; }
        return String(tokens.anilistId);
      case 'malId':
        if (tokens.malId == null) { missing = true; return ''; }
        return String(tokens.malId);
      case 'slug':
        return encodeToken(tokens.slug);
      case 'title':
        return encodeToken(tokens.title);
      case 'year':
        if (tokens.year == null) { missing = true; return ''; }
        return String(tokens.year);
      case 'season':
        if (!tokens.season) { missing = true; return ''; }
        return encodeToken(tokens.season.toLowerCase());
      case 'episode':
        return String(Math.max(1, Math.trunc(episode)));
      case 'episode2':
        return padEpisode(episode, 2);
      case 'episode3':
        return padEpisode(episode, 3);
      default:
        return '';
    }
  });
  return missing ? null : expanded;
}

/** Rejects anything that is not a safe, public HTTPS media endpoint. */
export function isSafeMediaEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return false;
  return true;
}

/** Hostnames a definition can ever reach, ignoring templated (dynamic) hosts. */
export function staticHostsForDefinition(definition: StreamServerDefinition): string[] {
  const episodeTemplates = Object.values(definition.episodes ?? {}).flatMap((entries) => Object.values(entries));
  const candidates = [definition.template, ...Object.values(definition.titles ?? {}), ...episodeTemplates];
  const hosts = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || candidate.includes('{')) {
      // Only skip when the token sits inside the authority component.
      const authority = candidate.split('://')[1]?.split('/')[0] ?? '';
      if (authority.includes('{')) continue;
    }
    try {
      const host = new URL(candidate.replace(TOKEN_PATTERN, 'x')).hostname.toLowerCase().replace(/\.$/, '');
      if (host) hosts.add(host);
    } catch {
      // Ignore unparseable templates; validation reports them separately.
    }
  }
  return [...hosts];
}

export interface DefinitionIssue {
  index: number;
  id: string;
  message: string;
}

const LANGUAGES: StreamLanguage[] = ['sub', 'dub', 'raw', 'mixed'];
const KINDS: StreamKind[] = ['hls', 'mp4'];

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function isBracketPlaceholder(value: string): boolean {
  return /^\[[^\]]+\]$/.test(value.trim());
}

function parseEpisodeTemplates(value: unknown): EpisodeTemplateMap {
  const episodes: EpisodeTemplateMap = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return episodes;

  for (const [rawTitleKey, rawEntries] of Object.entries(value as Record<string, unknown>)) {
    const titleKey = rawTitleKey.trim().toLowerCase();
    if (!titleKey || !rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) continue;

    const entries: Record<string, string> = {};
    for (const [rawEpisode, rawUrl] of Object.entries(rawEntries as Record<string, unknown>)) {
      const episode = Number.parseInt(rawEpisode, 10);
      const url = asString(rawUrl);
      if (!Number.isSafeInteger(episode) || episode < 1 || episode > 5000 || !url || isBracketPlaceholder(url)) continue;
      entries[String(episode)] = url;
    }
    if (Object.keys(entries).length > 0) episodes[titleKey] = entries;
  }

  return episodes;
}

/**
 * Validates operator-supplied server definitions. Bad entries are dropped with
 * a reported reason instead of taking the whole registry down.
 */
export function parseServerDefinitions(raw: unknown): {
  servers: StreamServerDefinition[];
  issues: DefinitionIssue[];
} {
  const issues: DefinitionIssue[] = [];
  const servers: StreamServerDefinition[] = [];
  if (!Array.isArray(raw)) {
    return { servers, issues: [{ index: -1, id: '', message: 'Expected a JSON array of server definitions.' }] };
  }

  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      issues.push({ index, id: '', message: 'Entry is not an object.' });
      return;
    }
    const record = entry as Record<string, unknown>;
    const id = asString(record.id).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64);
    const name = asString(record.name) || id;
    const templateInput = asString(record.template ?? record.urlTemplate ?? record.manifestUrl);
    const template = isBracketPlaceholder(templateInput) ? '' : templateInput;
    const placeholder = record.placeholder === true;

    if (!id) {
      issues.push({ index, id: '', message: 'Missing "id".' });
      return;
    }
    if (seen.has(id)) {
      issues.push({ index, id, message: 'Duplicate "id"; later definition ignored.' });
      return;
    }
    const scope: ServerScope = asString(record.scope, 'universal') === 'mapped' ? 'mapped' : 'universal';

    const titlesRaw = record.titles;
    const titles: Record<string, string> = {};
    if (titlesRaw && typeof titlesRaw === 'object' && !Array.isArray(titlesRaw)) {
      for (const [key, value] of Object.entries(titlesRaw as Record<string, unknown>)) {
        const url = asString(value);
        if (url && !isBracketPlaceholder(url)) titles[key.trim().toLowerCase()] = url;
      }
    }
    const episodes = parseEpisodeTemplates(record.episodes);
    const hasMappedUrls = Object.keys(titles).length > 0 || Object.keys(episodes).length > 0;

    // Template files may include dormant slots. They are intentionally silent:
    // replacing the bracketed value with one URL is enough to activate a slot.
    if (placeholder && !template && !hasMappedUrls) return;

    if (!template && scope === 'universal') {
      issues.push({ index, id, message: 'Universal servers need a "template".' });
      return;
    }
    if (scope === 'mapped' && !hasMappedUrls) {
      issues.push({ index, id, message: 'Mapped servers need a non-empty "titles" or "episodes" map.' });
      return;
    }

    const language = LANGUAGES.includes(asString(record.language, 'sub') as StreamLanguage)
      ? (asString(record.language, 'sub') as StreamLanguage)
      : 'sub';
    const kind = KINDS.includes(asString(record.kind, 'hls') as StreamKind)
      ? (asString(record.kind, 'hls') as StreamKind)
      : 'hls';
    const priorityRaw = Number(record.priority);
    const priority = Number.isFinite(priorityRaw) ? priorityRaw : 100 + index;

    seen.add(id);
    servers.push({
      id,
      name: name.slice(0, 80),
      group: (asString(record.group, 'Licensed') || 'Licensed').slice(0, 40),
      language,
      kind,
      priority,
      requiresProxy: record.requiresProxy === false ? false : true,
      template,
      scope,
      titles: Object.keys(titles).length ? titles : undefined,
      episodes: Object.keys(episodes).length ? episodes : undefined,
      quality: asString(record.quality) || undefined,
      note: asString(record.note).slice(0, 200) || undefined,
      enabled: record.enabled === false ? false : true,
      isReference: record.isReference === true,
    });
  });

  return { servers: servers.sort((left, right) => left.priority - right.priority), issues };
}

export function definitionToMirror(
  definition: StreamServerDefinition,
  tokens: TitleTokens,
  episode: number,
  titleKeys: string[],
): StreamMirrorNode | null {
  let template = definition.template;
  let mapped = false;

  if (definition.episodes) {
    const exact = titleKeys
      .map((key) => definition.episodes?.[key]?.[String(episode)])
      .find((value): value is string => Boolean(value));
    if (exact) {
      template = exact;
      mapped = true;
    }
  }

  if (!mapped && definition.titles) {
    const titleTemplate = titleKeys
      .map((key) => definition.titles?.[key])
      .find((value): value is string => Boolean(value));
    if (titleTemplate) {
      template = titleTemplate;
      mapped = true;
    }
  }

  if (!mapped && definition.scope === 'mapped') return null;

  const url = template ? expandTemplate(template, tokens, episode) : null;
  if (!url || !isSafeMediaEndpoint(url)) return null;

  return {
    id: definition.id,
    serverName: definition.name,
    group: definition.group,
    language: definition.language,
    kind: definition.kind,
    manifestUrl: url,
    requiresProxy: definition.requiresProxy,
    priority: definition.priority,
    quality: definition.quality,
    note: definition.note,
    isReference: definition.isReference,
  };
}

/** Builds the ranked mirror list the player consumes. */
export function resolveEpisodeMirrors(
  definitions: readonly StreamServerDefinition[],
  tokens: TitleTokens,
  episode: number,
  titleKeys: string[],
): StreamMirrorNode[] {
  const keys = titleKeys.map((key) => key.toLowerCase());
  const mirrors: StreamMirrorNode[] = [];
  const seenUrls = new Set<string>();

  for (const definition of [...definitions].sort((left, right) => left.priority - right.priority)) {
    if (!definition.enabled) continue;
    const mirror = definitionToMirror(definition, tokens, episode, keys);
    if (!mirror) continue;
    if (seenUrls.has(mirror.manifestUrl)) continue;
    seenUrls.add(mirror.manifestUrl);
    mirrors.push(mirror);
  }
  return mirrors;
}
