const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

/**
 * AniList and Jikan synopses arrive with markup (`<br>`, `<i>`, entities, and
 * MAL's "[Written by MAL Rewrite]" footer). Render them as plain text so the
 * UI never needs `dangerouslySetInnerHTML`.
 */
export function toPlainText(value: string | null | undefined, maxLength = 900): string {
  if (!value) return '';
  let text = value
    .replace(/<\s*br\s*\/?\s*>/gi, ' ')
    .replace(/<\/\s*p\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/\[Written by MAL Rewrite\]/gi, '');

  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(replacement);
  }
  text = text.replace(/&#(\d+);/g, (_match, code: string) => {
    const point = Number.parseInt(code, 10);
    return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : '';
  });

  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** `TV_SHORT` → `TV Short`, `OVA` → `OVA`. */
export function humanizeFormat(format: string | null | undefined): string {
  if (!format) return 'Series';
  const known: Record<string, string> = {
    TV: 'TV',
    TV_SHORT: 'TV Short',
    MOVIE: 'Movie',
    SPECIAL: 'Special',
    OVA: 'OVA',
    ONA: 'ONA',
    MUSIC: 'Music',
  };
  return known[format] ?? format.replace(/_/g, ' ');
}

/** Builds the `Series · 24 episodes` display line. */
export function formatLine(format: string | null | undefined, episodes: number | null | undefined): string {
  const label = humanizeFormat(format);
  if (label === 'Movie') return 'Film';
  if (!episodes || episodes < 1) return label;
  return `${label} · ${episodes} episode${episodes === 1 ? '' : 's'}`;
}

/** Title-cases an AniList season enum. */
export function humanizeSeason(season: string | null | undefined, year: number | null | undefined): string {
  if (!season) return year ? String(year) : '';
  const pretty = season.charAt(0) + season.slice(1).toLowerCase();
  return year ? `${pretty} ${year}` : pretty;
}
