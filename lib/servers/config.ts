import { SERVER_REGISTRY, type ServerDefinition } from './registry';

/**
 * Per-server operator configuration, read from the environment.
 *
 * | Variable                             | Meaning                                              |
 * | ------------------------------------ | ---------------------------------------------------- |
 * | `ANIVERSE_SERVER_<ID>`               | https base origin for that server (`_` for `-`)      |
 * | `ANIVERSE_SERVERS_DISABLED`          | comma-separated server ids to switch off             |
 * | `ANIVERSE_SOURCE_MAP_URL`            | https endpoint returning the episode→file source map |
 * | `ANIVERSE_SOURCE_MAP_INLINE`         | inline JSON source map (small deployments)           |
 * | `ANIVERSE_MEDIA_ALLOWED_HOSTS`       | proxy allowlist (already used by `/api/proxy`)       |
 *
 * Example: `ANIVERSE_SERVER_FILEMOON=https://filemoon.sx`
 */
export interface ServerRuntimeConfig {
  definition: ServerDefinition;
  /** Effective base origin (config override, else `https://<host>`). */
  baseUrl: string;
  enabled: boolean;
  /** `true` when the operator explicitly supplied a base URL. */
  configured: boolean;
  disabledReason?: string;
}

/** `aniverse-origin` → `ANIVERSE_SERVER_ANIVERSE_ORIGIN` */
export function envKeyForServer(id: string): string {
  return `ANIVERSE_SERVER_${id.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`;
}

function parseIdList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Accepts only absolute https origins; strips any trailing slash. */
function normalizeBase(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function getServerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ServerRuntimeConfig[] {
  const disabled = parseIdList(env.ANIVERSE_SERVERS_DISABLED);

  return SERVER_REGISTRY.map((definition) => {
    const override = normalizeBase(env[envKeyForServer(definition.id)]);
    const isDisabled = disabled.has(definition.id);

    // `aniverse-origin` is a pure placeholder host; it is only usable once the
    // operator points it at a real origin.
    const needsExplicitBase = definition.host.endsWith('.invalid');
    const baseUrl = override ?? (needsExplicitBase ? '' : `https://${definition.host}`);

    return {
      definition,
      baseUrl,
      enabled: !isDisabled && baseUrl !== '',
      configured: override !== null,
      disabledReason: isDisabled
        ? 'Switched off via ANIVERSE_SERVERS_DISABLED.'
        : baseUrl === ''
          ? `Set ${envKeyForServer(definition.id)} to an https base URL.`
          : undefined,
    };
  });
}

export interface SourceMapConfig {
  url: string | null;
  inline: string | null;
  /** `true` when at least one source of episode→file mappings exists. */
  present: boolean;
}

export function getSourceMapConfig(env: NodeJS.ProcessEnv = process.env): SourceMapConfig {
  const url = normalizeBase(env.ANIVERSE_SOURCE_MAP_URL);
  const inline = env.ANIVERSE_SOURCE_MAP_INLINE?.trim() || null;
  return { url, inline, present: Boolean(url || inline) };
}
