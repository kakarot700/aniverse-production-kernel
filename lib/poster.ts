/**
 * Deterministic locally-rendered cover art.
 *
 * The offline seed catalog does not hotlink anyone's artwork, so it points at
 * `/api/poster` instead, which renders this SVG. Same title in, same poster
 * out; no network, no binary assets in the repo.
 */

const WIDTH = 460;
const HEIGHT = 690;
export const MAX_POSTER_TITLE_LENGTH = 90;

/** Golden angle — spreads sequential hashes evenly around the colour wheel. */
const GOLDEN_ANGLE = 137.508;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Greedy wrap tuned for the 34px display face used below. */
function wrap(title: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxCharsPerLine ? `${word.slice(0, maxCharsPerLine - 1)}…` : word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s…]+$/, '')}…`;
  }
  return lines.length ? lines : ['Untitled'];
}

export function renderPosterSvg(title: string, seed: string): string {
  const digest = hash(seed || title);

  // Golden-angle rotation gives neighbouring hashes visibly different hues,
  // instead of the clustering a plain `digest % 360` produces in practice.
  const hue = ((digest % 997) * GOLDEN_ANGLE) % 360;
  const hueAccent = (hue + 130 + ((digest >>> 11) % 70)) % 360;
  const saturation = 54 + ((digest >>> 5) % 26);
  const motif = (digest >>> 13) % 3;

  const top = `hsl(${hue.toFixed(1)} ${saturation}% ${62 + ((digest >>> 7) % 14)}%)`;
  const mid = `hsl(${((hue + hueAccent) / 2).toFixed(1)} ${saturation - 8}% 44%)`;
  const bottom = `hsl(${hueAccent.toFixed(1)} ${saturation + 6}% ${20 + ((digest >>> 9) % 10)}%)`;
  const ink = `hsl(${hue.toFixed(1)} 90% 92%)`;

  const lines = wrap(title, 15, 4);
  const blockHeight = lines.length * 42;
  const startY = HEIGHT - 82 - blockHeight + 42;

  const text = lines
    .map(
      (line, index) =>
        `<text x="38" y="${startY + index * 42}" fill="#ffffff" font-family="Georgia, 'Times New Roman', serif" font-size="34" letter-spacing="-0.6">${escapeXml(line)}</text>`,
    )
    .join('');

  // Three deterministic motifs so the grid does not read as one repeated
  // gradient; which one a title gets is stable across renders.
  let art = '';
  if (motif === 0) {
    art = Array.from({ length: 5 }, (_unused, index) => {
      const radius = 70 + index * 58;
      const centreX = 90 + ((digest >>> (index * 3)) % 240);
      const centreY = 150 + ((digest >>> (index * 4)) % 190);
      return `<circle cx="${centreX}" cy="${centreY}" r="${radius}" fill="none" stroke="${ink}" stroke-width="1.6" opacity="${(0.34 - index * 0.05).toFixed(2)}" />`;
    }).join('');
  } else if (motif === 1) {
    art = Array.from({ length: 7 }, (_unused, index) => {
      const offset = -120 + index * 96 + ((digest >>> (index * 2)) % 40);
      return `<path d="M ${offset} ${HEIGHT} L ${offset + 250} 0" fill="none" stroke="${ink}" stroke-width="${2 + (index % 3)}" opacity="${(0.3 - index * 0.03).toFixed(2)}" />`;
    }).join('');
  } else {
    const centreX = WIDTH / 2 + ((digest >>> 6) % 90) - 45;
    const centreY = 240 + ((digest >>> 8) % 90);
    art =
      `<circle cx="${centreX}" cy="${centreY}" r="${118 + ((digest >>> 4) % 52)}" fill="${ink}" opacity="0.2" />` +
      Array.from({ length: 16 }, (_unused, index) => {
        const angle = (index / 16) * Math.PI * 2;
        const inner = 132 + ((digest >>> 4) % 52);
        const outer = inner + 44 + ((digest >>> (index % 8)) % 40);
        return `<line x1="${(centreX + Math.cos(angle) * inner).toFixed(1)}" y1="${(centreY + Math.sin(angle) * inner).toFixed(1)}" x2="${(centreX + Math.cos(angle) * outer).toFixed(1)}" y2="${(centreY + Math.sin(angle) * outer).toFixed(1)}" stroke="${ink}" stroke-width="2" opacity="0.26" />`;
      }).join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0.1" y1="0" x2="0.75" y2="1">
      <stop offset="0%" stop-color="${top}" />
      <stop offset="52%" stop-color="${mid}" />
      <stop offset="100%" stop-color="${bottom}" />
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0.42" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(10,12,20,0)" />
      <stop offset="100%" stop-color="rgba(10,12,20,0.82)" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
  <g>${art}</g>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)" />
  ${text}
</svg>`;
}
