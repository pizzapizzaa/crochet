import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import {
  buildRoundLabel,
  buildSquareLabel,
  DEFAULT_ROUND_MESSAGE,
  DEFAULT_TAGLINE,
  LABEL_FONT_FILES,
  labelSlug,
  mmToPx,
  setPngDpi,
  svgAtPixelSize,
  type LabelFonts,
} from '../src/lib/labels';

/*
 * The labels go to a print shop, so the things worth pinning down are the
 * physical size, that no live text is left for a missing font to break, and
 * that content too long for the sticker is reported rather than clipped.
 */

const load = (path: string) => {
  const file = readFileSync(`public${path}`);
  return opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
};

const fonts = Object.fromEntries(
  Object.entries(LABEL_FONT_FILES).map(([key, path]) => [key, load(path)]),
) as unknown as LabelFonts;

const square = (overrides: Partial<Parameters<typeof buildSquareLabel>[0]> = {}) =>
  buildSquareLabel(
    {
      bundleName: 'Bundle for beginners',
      items: ['2 × Cotton yarn, 50 g', '1 × Bamboo hook, 4 mm', '6 × Stitch markers'],
      totalWeight: '320 g',
      material: '100% cotton yarn, bamboo',
      ...overrides,
    },
    fonts,
  );

describe('round thank-you sticker', () => {
  const label = buildRoundLabel({ message: DEFAULT_ROUND_MESSAGE, tagline: DEFAULT_TAGLINE }, fonts);

  it('is 7 cm across', () => {
    expect(label.sizeMm).toBe(70);
    expect(label.svg).toContain('width="70mm" height="70mm" viewBox="0 0 70 70"');
    expect(label.warnings).toEqual([]);
  });

  it('outlines its text instead of relying on fonts', () => {
    expect(label.svg).not.toMatch(/<text|font-family/);
    expect(label.svg).not.toContain('NaN');
  });

  it('grows by the bleed on every side', () => {
    const bled = buildRoundLabel({ message: DEFAULT_ROUND_MESSAGE, bleedMm: 2 }, fonts);
    expect(bled.sizeMm).toBe(74);
    expect(bled.svg).toContain('viewBox="-2 -2 74 74"');
    expect(bled.svg).toContain('r="37"');
  });

  it('says so when the message cannot fit the arc', () => {
    const long = buildRoundLabel({ message: 'Thank you so very much '.repeat(8), tagline: 'x' }, fonts);
    expect(long.warnings).toHaveLength(1);
  });
});

describe('square bundle label', () => {
  it('is 12 cm square and fits ordinary content without complaint', () => {
    const label = square();
    expect(label.sizeMm).toBe(120);
    expect(label.svg).toContain('width="120mm" height="120mm" viewBox="0 0 120 120"');
    expect(label.svg).not.toMatch(/<text|font-family|NaN/);
    expect(label.warnings).toEqual([]);
  });

  it('escapes the bundle name in the title', () => {
    expect(square({ bundleName: 'Hooks <& "needles">' }).svg).toContain(
      '<title>Hooks &lt;&amp; &quot;needles&quot;&gt;</title>',
    );
  });

  it('draws the weight and material panels only when they are filled in', () => {
    const panels = (svg: string) => svg.match(/rx="2\.6"/g)?.length ?? 0;
    expect(panels(square().svg)).toBe(2);
    expect(panels(square({ material: '' }).svg)).toBe(1);
    expect(panels(square({ material: ' ', totalWeight: '' }).svg)).toBe(0);
  });

  it('wraps a long material in full, growing the panels instead of cutting it', () => {
    const panelHeight = (svg: string) => Number(svg.match(/height="([\d.]+)" rx="2\.6"/)?.[1]);
    const long = square({
      material:
        '60% cotton, 40% acrylic yarn; aluminium hooks; polyester stuffing; glass safety eyes; ' +
        'wooden buttons; recycled paper pattern card; averyveryveryveryveryveryverylongunbrokenword',
    });
    expect(long.warnings).toEqual([]);
    expect(panelHeight(square().svg)).toBe(17);
    expect(panelHeight(long.svg)).toBeGreaterThan(25);
  });

  it('ignores blank lines in the item list', () => {
    expect(square({ items: ['One', '', '  ', 'Two'] }).svg).toBe(square({ items: ['One', 'Two'] }).svg);
  });

  it('reports an item list that is too long instead of overflowing', () => {
    const items = Array.from({ length: 40 }, (_, i) => `${i + 1} × A fairly long item description`);
    const label = square({ items });
    expect(label.warnings.join(' ')).toMatch(/Only \d+ of 40 items fit/);
  });

  it('reports a bundle name too long for two lines', () => {
    const label = square({ bundleName: 'An extraordinarily long bundle name '.repeat(5) });
    expect(label.warnings.join(' ')).toMatch(/bundle name is too long/);
  });
});

describe('export helpers', () => {
  it('converts millimetres to pixels at a print resolution', () => {
    expect(mmToPx(70, 300)).toBe(827);
    expect(mmToPx(120, 600)).toBe(2835);
  });

  it('resizes the drawing for rasterising without touching the viewBox', () => {
    const svg = svgAtPixelSize(square().svg, 2835);
    expect(svg).toContain('width="2835" height="2835" viewBox="0 0 120 120"');
  });

  it('stamps a PNG with its resolution straight after IHDR', () => {
    const png = new Uint8Array(45).fill(7);
    const out = setPngDpi(png, 300);
    const view = new DataView(out.buffer);

    expect(out.length).toBe(png.length + 21);
    expect(view.getUint32(33)).toBe(9);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    expect(view.getUint32(41)).toBe(11811); // 300 dpi in pixels per metre
    expect(view.getUint32(45)).toBe(11811);
    expect(out[49]).toBe(1);
    // The CRC every 300 dpi PNG carries for this chunk (checked against zlib).
    expect(view.getUint32(50)).toBe(0x78a53f76);
    expect([...out.subarray(54)]).toEqual([...png.subarray(33)]);
  });

  it('makes a filename out of a Vietnamese bundle name', () => {
    expect(labelSlug('Bộ kit móc len — Đầu tiên!', 'untitled')).toBe('bo-kit-moc-len-dau-tien');
    expect(labelSlug('  ', 'untitled')).toBe('untitled');
  });
});
