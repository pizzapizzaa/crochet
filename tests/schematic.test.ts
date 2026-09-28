import { describe, expect, it } from 'vitest';
import { niceStep, schematicSvg } from '../src/lib/schematic';
import type { SchematicInput } from '../src/lib/schematic';

const base: SchematicInput = {
  widthCm: 30,
  heightCm: 30,
  stitchesAcross: 48,
  totalRows: 60,
  foundationNote: 'Foundation: ch 49 · 48 stitches per row',
  stitchesPer5cm: 8,
  rowsPer5cm: 10,
  stitchLabel: 'Single Crochet (sc)',
  hookSize: '5.0mm',
  yarnLabel: 'Medium / Worsted (4)',
  projectType: 'Blanket',
};

describe('schematicSvg', () => {
  it("carries the pattern's own numbers", () => {
    const svg = schematicSvg(base);
    expect(svg).toContain('ch 49');
    expect(svg).toContain('48 stitches per row');
    expect(svg).toContain('60 rows');
    expect(svg).toContain('30 cm');
    expect(svg).toContain('8 sts × 10 rows per 5 cm');
  });

  it('keeps the shape of the finished piece', () => {
    const svg = schematicSvg({ ...base, widthCm: 20, heightCm: 150 });
    const panel = svg.match(/<rect x="[^"]+" y="72" width="([\d.]+)" height="([\d.]+)"/);
    expect(panel).not.toBeNull();
    const [, w, h] = panel!.map(Number);
    expect(h / w).toBeCloseTo(150 / 20, 1);
  });

  it('escapes text it was given', () => {
    const svg = schematicSvg({ ...base, yarnLabel: 'Yarn <script>alert(1)</script> & co', projectType: 'Bag "x"' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp; co');
  });

  it('draws the gauge square to scale only when it would be visible', () => {
    expect(schematicSvg(base)).toContain('to scale');
    expect(schematicSvg({ ...base, widthCm: 400, heightCm: 400 })).toContain('not to scale');
  });
});

describe('niceStep', () => {
  it('labels a count in round steps', () => {
    expect(niceStep(60, 10)).toBe(10);
    expect(niceStep(8, 10)).toBe(1);
    expect(niceStep(430, 10)).toBe(50);
  });
});
