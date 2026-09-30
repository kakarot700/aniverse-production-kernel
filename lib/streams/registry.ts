/**
 * Runtime stream-server registry (server side).
 *
 * Reads operator configuration once per process and exposes:
 *  - the active server list,
 *  - the derived media-proxy host allowlist,
 *  - configuration diagnostics for `GET /api/servers`.
 *
 * Configuration precedence:
 *  1. `ANIVERSE_STREAM_SERVERS`      – JSON array of server definitions
 *  2. `ANIVERSE_STREAM_SERVERS_FILE` – path to a JSON file with the same shape
 *  3. `config/stream-servers.json`   – auto-detected paste file (gitignored)
 *  4. built-in public reference streams (unless disabled)
 */
import type { AnimeDetail, AnimeSummary } from '@/types/anime';
import type { StreamMirrorNode } from '@/types/media';
import {
  parseServerDefinitions,
  REFERENCE_SERVERS,
  resolveEpisodeMirrors,
  staticHostsForDefinition,
  type DefinitionIssue,
  type StreamServerDefinition,
  type TitleTokens,
} from './definitions';

export interface RegistrySnapshot {
  servers: StreamServerDefinition[];
  issues: DefinitionIssue[];
  referenceStreamsEnabled: boolean;
  configuredCount: number;
  allowedHosts: string[];
  loadedFrom: 'env' | 'file' | 'default-file' | 'none';
}

/**
 * Config file auto-detected when neither `ANIVERSE_STREAM_SERVERS` nor
 * `ANIVERSE_STREAM_SERVERS_FILE` is set: drop your server list at
 * `config/stream-servers.json` (already gitignored, so signed URLs never get
 * committed) and it is picked up with zero environment configuration.
 */
export const DEFAULT_SERVERS_FILE = 'config/stream-servers.json';

/**
 * `undefined` – auto-detect `${process.cwd()}/${DEFAULT_SERVERS_FILE}`.
 * `string`   – probe that path instead (tests point this at fixtures).
 * `null`     – never auto-detect (tests keep the registry hermetic).
 */
let defaultServersFileOverride: string | null | undefined;

/** Test/seeding hook for the auto-detected config path; production never needs it. */
export function setDefaultServersFile(path: string | null | undefined): void {
  defaultServersFileOverride = path;
}

let snapshot: RegistrySnapshot | null = null;

function readFileConfig(path: string): { value: unknown; error?: string } {
  try {
    // Node-only, lazily required so bundlers never pull fs into a client graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    return { value: JSON.parse(fs.readFileSync(path, 'utf8')) };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : 'Unreadable file.' };
  }
}

function fileExists(path: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

function defaultServersFilePath(): string | null {
  if (defaultServersFileOverride !== undefined) return defaultServersFileOverride;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath = require('node:path') as typeof import('node:path');
    return nodePath.join(process.cwd(), DEFAULT_SERVERS_FILE);
  } catch {
    return null;
  }
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

export function parseAllowedHostList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}

function buildSnapshot(): RegistrySnapshot {
  const issues: DefinitionIssue[] = [];
  let configured: StreamServerDefinition[] = [];
  let loadedFrom: RegistrySnapshot['loadedFrom'] = 'none';

  const inlineJson = process.env.ANIVERSE_STREAM_SERVERS?.trim();
  const filePath = process.env.ANIVERSE_STREAM_SERVERS_FILE?.trim();

  if (inlineJson) {
    try {
      const parsed = parseServerDefinitions(JSON.parse(inlineJson));
      configured = parsed.servers;
      issues.push(...parsed.issues);
      loadedFrom = 'env';
    } catch (error) {
      issues.push({
        index: -1,
        id: '',
        message: `ANIVERSE_STREAM_SERVERS is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`,
      });
    }
  } else if (filePath) {
    const file = readFileConfig(filePath);
    if (file.error) {
      issues.push({ index: -1, id: '', message: `ANIVERSE_STREAM_SERVERS_FILE could not be read: ${file.error}` });
    } else {
      const parsed = parseServerDefinitions(file.value);
      configured = parsed.servers;
      issues.push(...parsed.issues);
      loadedFrom = 'file';
    }
  } else {
    // Zero-config path: an operator who drops a file at config/stream-servers.json
    // never needs to touch an environment variable. A missing file is not an
    // error — a fresh checkout simply falls through to the reference streams.
    const defaultPath = defaultServersFilePath();
    if (defaultPath && fileExists(defaultPath)) {
      const file = readFileConfig(defaultPath);
      if (file.error) {
        issues.push({ index: -1, id: '', message: `${DEFAULT_SERVERS_FILE} could not be read: ${file.error}` });
      } else {
        const parsed = parseServerDefinitions(file.value);
        configured = parsed.servers;
        issues.push(...parsed.issues);
        loadedFrom = 'default-file';
      }
    }
  }

  const referenceStreamsEnabled = booleanEnv(
    process.env.ANIVERSE_ENABLE_REFERENCE_STREAMS,
    // Reference streams stay on by default so a fresh checkout can play video;
    // turn them off once real servers are configured.
    true,
  );

  const servers = [...configured, ...(referenceStreamsEnabled ? REFERENCE_SERVERS : [])].sort(
    (left, right) => left.priority - right.priority,
  );

  const allowedHosts = new Set(parseAllowedHostList(process.env.ANIVERSE_MEDIA_ALLOWED_HOSTS));
  for (const definition of servers) {
    if (!definition.enabled) continue;
    for (const host of staticHostsForDefinition(definition)) allowedHosts.add(host);
  }

  return {
    servers,
    issues,
    referenceStreamsEnabled,
    configuredCount: configured.length,
    allowedHosts: [...allowedHosts],
    loadedFrom,
  };
}

export function getRegistry(): RegistrySnapshot {
  snapshot ??= buildSnapshot();
  return snapshot;
}

/** Test/hot-reload helper. */
export function resetRegistry(): void {
  snapshot = null;
}

/**
 * Hosts the media proxy may contact: explicit allowlist entries plus every
 * static host referenced by a configured server. Server templates come from
 * trusted operator configuration, never from user input.
 */
export function getAllowedMediaHosts(): string[] {
  return getRegistry().allowedHosts;
}

export function titleKeysFor(anime: Pick<AnimeSummary, 'id' | 'slug' | 'anilistId' | 'malId'>): string[] {
  const keys = [anime.id.toLowerCase(), anime.slug.toLowerCase()];
  if (anime.anilistId != null) keys.push(`anilist:${anime.anilistId}`, String(anime.anilistId));
  if (anime.malId != null) keys.push(`mal:${anime.malId}`);
  return [...new Set(keys)];
}

export function tokensFor(anime: AnimeSummary | AnimeDetail): TitleTokens {
  return {
    anilistId: anime.anilistId,
    malId: anime.malId,
    slug: anime.slug,
    title: anime.titles.romaji || anime.title,
    year: anime.year,
    season: anime.season,
  };
}

export function getEpisodeMirrors(anime: AnimeSummary | AnimeDetail, episodeNumber: number): StreamMirrorNode[] {
  const registry = getRegistry();
  return resolveEpisodeMirrors(registry.servers, tokensFor(anime), episodeNumber, titleKeysFor(anime));
}

export interface PublicServerInfo {
  id: string;
  name: string;
  group: string;
  language: string;
  kind: string;
  priority: number;
  requiresProxy: boolean;
  scope: string;
  enabled: boolean;
  isReference: boolean;
  quality: string | null;
  note: string | null;
  mappedTitles: number;
}

/** Registry view safe to expose over HTTP: no URL templates, no secrets. */
export function describeServers(): PublicServerInfo[] {
  return getRegistry().servers.map((definition) => ({
    id: definition.id,
    name: definition.name,
    group: definition.group,
    language: definition.language,
    kind: definition.kind,
    priority: definition.priority,
    requiresProxy: definition.requiresProxy,
    scope: definition.scope,
    enabled: definition.enabled,
    isReference: definition.isReference,
    quality: definition.quality ?? null,
    note: definition.note ?? null,
    mappedTitles: definition.titles ? Object.keys(definition.titles).length : 0,
  }));
}
