export type MediaUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: 'invalid-url' | 'https-required' | 'credentials-forbidden' | 'host-not-allowed' | 'unsafe-host' };

function hostMatches(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some((entry) => {
    const pattern = entry.trim().toLowerCase().replace(/\.$/, '');
    if (!pattern) return false;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return host !== suffix && host.endsWith(`.${suffix}`);
    }
    return host === pattern;
  });
}

export function parseAllowedMediaUrl(raw: string, allowedHosts: readonly string[]): MediaUrlResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'https-required' };
  if (url.username || url.password) return { ok: false, reason: 'credentials-forbidden' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'unsafe-host' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'unsafe-host' };
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return { ok: false, reason: 'unsafe-host' };
  if (!hostMatches(host, allowedHosts)) return { ok: false, reason: 'host-not-allowed' };

  url.hash = '';
  return { ok: true, url };
}

function makeProxyUrl(target: URL, proxyEndpoint: string): string {
  const proxy = new URL(proxyEndpoint, 'https://aniverse.invalid');
  proxy.searchParams.set('url', target.toString());
  return `${proxy.pathname}${proxy.search}`;
}

export function rewriteHlsManifest(manifest: string, manifestUrl: string, proxyEndpoint = '/api/proxy'): string {
  const base = new URL(manifestUrl);
  return manifest.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (attribute, rawUri: string) => {
        try {
          const target = new URL(rawUri, base);
          if (target.protocol !== 'https:' && target.protocol !== 'http:') return attribute;
          return `URI="${makeProxyUrl(target, proxyEndpoint)}"`;
        } catch {
          return attribute;
        }
      });
    }

    try {
      const target = new URL(trimmed, base);
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return line;
      return makeProxyUrl(target, proxyEndpoint);
    } catch {
      return line;
    }
  }).join('\n');
}

export function parseAllowedHosts(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((host) => host.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
}
