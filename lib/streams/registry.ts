// lib/streams/registry.ts
import { AnimeServerExtractor, StreamSourcePayload, ServerProviderType } from './definitions';

/**
 * Class A: Regular Expression Standard HLS Extractors
 * Handles: Vidplay, MyCloud, MegaF, Vidhide, Streamwish, Voe
 */
export class StandardHLSMatcher implements AnimeServerExtractor {
  constructor(
    public providerType: ServerProviderType,
    private domains: string[]
  ) {}

  canExtract(embedUrl: string): boolean {
    return this.domains.some(domain => embedUrl.toLowerCase().includes(domain));
  }

  async extractStreams(embedUrl: string, userAgent: string): Promise<StreamSourcePayload[]> {
    try {
      const origin = new URL(embedUrl).origin;
      const response = await fetch(embedUrl, {
        headers: { 'User-Agent': userAgent, 'Referer': origin, 'Origin': origin }
      });
      const html = await response.text();

      // Universal pattern match for active master playlist manifest strings
      const hlsRegex = /(?:file|sources?|src|url)\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i;
      const match = html.match(hlsRegex);

      if (!match) return [];

      return [{
        url: match[1],
        quality: 'auto',
        type: 'hls',
        headers: { 'Referer': origin, 'User-Agent': userAgent, 'Origin': origin }
      }];
    } catch {
      return [];
    }
  }
}

/**
 * Class B: IFrame HTML Dom Container Scrapers
 * Handles: Filemoon, NetuTV, Mp4Upload
 */
export class FrameSourceScraper implements AnimeServerExtractor {
  constructor(
    public providerType: ServerProviderType,
    private domains: string[],
    private targetFallbackExtension: 'm3u8' | 'mp4' = 'm3u8'
  ) {}

  canExtract(embedUrl: string): boolean {
    return this.domains.some(domain => embedUrl.toLowerCase().includes(domain));
  }

  async extractStreams(embedUrl: string, userAgent: string): Promise<StreamSourcePayload[]> {
    try {
      const origin = new URL(embedUrl).origin;
      const response = await fetch(embedUrl, { headers: { 'User-Agent': userAgent, 'Referer': origin } });
      const html = await response.text();

      const srcRegex = new RegExp(`["']([^"']+\\.(?:${this.targetFallbackExtension})[^"']*)["']`, 'i');
      const match = html.match(srcRegex);

      if (!match) return [];

      return [{
        url: match[1],
        quality: 'auto',
        type: this.targetFallbackExtension === 'm3u8' ? 'hls' : 'mp4',
        headers: { 'Referer': origin, 'User-Agent': userAgent }
      }];
    } catch {
      return [];
    }
  }
}

/**
 * Class C: Dedicated Split Variable Matchers
 * Handles: Doodstream, Streamtape
 */
export class TokenCompositionScraper implements AnimeServerExtractor {
  constructor(
    public providerType: ServerProviderType,
    private domains: string[]
  ) {}

  canExtract(embedUrl: string): boolean {
    return this.domains.some(domain => embedUrl.toLowerCase().includes(domain));
  }

  async extractStreams(embedUrl: string, userAgent: string): Promise<StreamSourcePayload[]> {
    try {
      const origin = new URL(embedUrl).origin;
      const response = await fetch(embedUrl, { headers: { 'User-Agent': userAgent, 'Referer': origin } });
      const html = await response.text();

      // Matches dynamic multi-token strings constructed inside standard custom video players
      const tokenRegex = /document\.getElementById\(['"](?:streamvideo\vert{}ideolink)['"]\)\.src\s*=\s*["']([^"']+)["']\s*\+\s*['"]([^'"]+)['"]/i;
      const match = html.match(tokenRegex);

      if (!match) {
        const singleUrlRegex = /data-video=["']([^"']+)["']/i;
        const fallbackMatch = html.match(singleUrlRegex);
        if (!fallbackMatch) return [];
        return [{ url: fallbackMatch[1], quality: 'auto', type: 'mp4', headers: { 'Referer': origin } }];
      }

      return [{
        url: `${match[1]}${match[2]}`,
        quality: 'auto',
        type: 'mp4',
        headers: { 'Referer': origin, 'User-Agent': userAgent }
      }];
    } catch {
      return [];
    }
  }
}

/**
 * Master Registry Controller Engine managing all 11 active servers simultaneously
 */
export class CentralStreamRegistry {
  private extractors: AnimeServerExtractor[] = [];

  constructor() {
    // 1. Direct Regex HLS Extractors
    this.extractors.push(new StandardHLSMatcher('VIDPLAY', ['vidplay', 'vizcloud']));
    this.extractors.push(new StandardHLSMatcher('MYCLOUD', ['mycloud', 'mcloud']));
    this.extractors.push(new StandardHLSMatcher('MEGAF', ['megaf', 'megaf.cc']));
    this.extractors.push(new StandardHLSMatcher('VIDHIDE', ['vidhide', 'vidsrc']));
    this.extractors.push(new StandardHLSMatcher('STREAMWISH', ['streamwish', 'strwish', 'awish']));
    this.extractors.push(new StandardHLSMatcher('VOE', ['voe', 'voe.sx']));

    // 2. IFrame DOM / Resource Track Scrapers
    this.extractors.push(new FrameSourceScraper('FILEMOON', ['filemoon', 'fmoon'], 'm3u8'));
    this.extractors.push(new FrameSourceScraper('NETUTV', ['netu', 'waaw', 'netutv'], 'm3u8'));
    this.extractors.push(new FrameSourceScraper('MP4UPLOAD', ['mp4upload'], 'mp4'));

    // 3. Token Combination Scrapers
    this.extractors.push(new TokenCompositionScraper('DOODSTREAM', ['doodstream', 'dood.to', 'dood.watch']));
    this.extractors.push(new TokenCompositionScraper('STREAMTAPE', ['streamtape', 'stape']));
  }

  async resolveAllAvailableServers(embedUrl: string, userAgent: string): Promise<StreamSourcePayload[]> {
    for (const extractor of this.extractors) {
      if (extractor.canExtract(embedUrl)) {
        return await extractor.extractStreams(embedUrl, userAgent);
      }
    }
    return [];
  }
}

export const DEFAULT_SERVER_CONFIG_FILE = 'config/stream-servers.json';

export function getRegistry() {
  return new CentralStreamRegistry();
}

export function getEpisodeMirrors(definitions: any[], tokens: any, episode: number, titleKeys: string[]) {
  return [];
}

export function getAllowedMediaHosts(definitions: any[]): string[] {
  return [];
}

export function describeServers(definitions: any[]): any[] {
  return [];
}
