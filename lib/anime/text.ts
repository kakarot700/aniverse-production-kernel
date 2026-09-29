const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * AniList descriptions still contain a little inline HTML even with
 * `asHtml: false`. Render them as plain text so nothing is injected into the
 * DOM and line breaks stay readable.
 */
export function stripHtml(value: string | null | undefined): string {
  if (!value) return '';
  return decodeEntities(
    value
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/\s*(p|div|li)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** `TV_SHORT` → `TV Short`, `ONA` → `ONA`. */
export function formatLabel(format: string): string {
  const upper = format.toUpperCase();
  if (upper === 'TV') return 'TV';
  if (upper === 'OVA' || upper === 'ONA' || upper === 'MOVIE' || upper === 'MUSIC' || upper === 'SPECIAL') {
    return titleCase(upper);
  }
  return titleCase(upper);
}

export function describeRuntime(record: {
  format: string;
  episodeCount: number | null;
  durationMinutes: number | null;
}): string {
  const label = formatLabel(record.format || 'TV');
  if (label === 'Movie') {
    if (!record.durationMinutes) return 'Movie';
    const hours = Math.floor(record.durationMinutes / 60);
    const minutes = record.durationMinutes % 60;
    return hours > 0 ? `Movie · ${hours}h ${minutes}m` : `Movie · ${minutes}m`;
  }
  if (record.episodeCount && record.episodeCount > 0) {
    return `${label} · ${record.episodeCount} episode${record.episodeCount === 1 ? '' : 's'}`;
  }
  return `${label} · ongoing`;
}
