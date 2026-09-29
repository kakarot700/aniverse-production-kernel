import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPosterSvg } from '../lib/poster';

test('poster rendering is deterministic for the same seed', () => {
  assert.equal(renderPosterSvg('Cowboy Bebop', 'cowboy-bebop'), renderPosterSvg('Cowboy Bebop', 'cowboy-bebop'));
  assert.notEqual(renderPosterSvg('Cowboy Bebop', 'cowboy-bebop'), renderPosterSvg('Cowboy Bebop', 'akira'));
});

test('poster output is a well-formed standalone SVG', () => {
  const svg = renderPosterSvg('Fullmetal Alchemist: Brotherhood', 'fmab');
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.match(svg, /viewBox="0 0 460 690"/);
  assert.match(svg, /role="img"/);
});

test('titles are escaped so a crafted query cannot inject markup', () => {
  const svg = renderPosterSvg('<script>alert(1)</script>', 'x');
  assert.ok(!svg.includes('<script>'), 'raw script tag must not survive');
  assert.match(svg, /&lt;script&gt;/);

  const quoted = renderPosterSvg('He said "hi" & left', 'y');
  assert.match(quoted, /&quot;hi&quot;/);
  assert.match(quoted, /&amp; left/);
});

test('long titles wrap across a bounded number of lines', () => {
  const svg = renderPosterSvg(
    'That Time I Got Reincarnated as a Slime and Founded an Entire Nation of Monsters',
    'slime',
  );
  const lines = svg.match(/<text /g) ?? [];
  assert.ok(lines.length > 1, 'long titles wrap');
  assert.ok(lines.length <= 4, 'wrapping is capped so text stays inside the poster');
  assert.ok(svg.includes('…'), 'overflow is elided');
});

test('an empty title still renders a usable poster', () => {
  const svg = renderPosterSvg('', '');
  assert.ok(svg.includes('Untitled'));
});

test('generated SVG stays numerically valid across the whole uint32 hash range', () => {
  // `digest` spans the full unsigned 32-bit range. A signed `>>` would make
  // roughly half of all titles produce negative hues, saturations, radii, and
  // motif indices — which browsers silently render as a blank rectangle.
  const samples = Array.from({ length: 400 }, (_unused, index) => `seed-${index}-${index * 7919}`);
  for (const seed of samples) {
    const svg = renderPosterSvg(`Title ${seed}`, seed);
    assert.ok(!/-\d+(\.\d+)?%/.test(svg), `negative percentage in poster for ${seed}`);
    assert.ok(!/r="-/.test(svg), `negative radius in poster for ${seed}`);
    assert.ok(!/hsl\(-/.test(svg), `negative hue in poster for ${seed}`);
    assert.ok(!svg.includes('NaN'), `NaN in poster for ${seed}`);
    assert.ok(!svg.includes('undefined'), `undefined in poster for ${seed}`);
  }
});

test('all three decorative motifs are reachable', () => {
  const motifs = new Set<string>();
  for (let index = 0; index < 300; index += 1) {
    const svg = renderPosterSvg('Sample', `seed-${index}`);
    // `<line` also prefixes `<linearGradient`, so match the element properly.
    const hasRays = svg.includes('<line x1=');
    if (svg.includes('<circle') && hasRays) motifs.add('burst');
    else if (svg.includes('<path d=')) motifs.add('diagonal');
    else if (svg.includes('<circle')) motifs.add('rings');
  }
  assert.equal(motifs.size, 3, 'poster art should not collapse to a single motif');
});
