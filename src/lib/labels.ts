/*
 * Sticker labels, drawn as SVG in millimetres.
 *
 * Every piece of text is converted to outlines with the brand's own font
 * files, so a label carries no font dependency: the SVG opens the same in a
 * browser, in Illustrator and at the print shop, and the PNG is just that
 * SVG rasterised. It also means text is measured exactly, which is what lets
 * a long bundle name or item list shrink to fit instead of running off the
 * sticker.
 *
 * Pure functions — the caller loads the fonts (fetch in the browser, fs in
 * tests) and hands them in.
 */
import type { Font, Path } from 'opentype.js';

export interface LabelFonts {
  /** Baloo 2 ExtraBold — the wordmark and headings. */
  display: Font;
  /** Nunito Sans SemiBold — body copy. */
  sans: Font;
  /** Nunito Sans Bold — eyebrows and emphasis. */
  sansBold: Font;
}

/** Where the font files live under /public, keyed like LabelFonts. */
export const LABEL_FONT_FILES: Record<keyof LabelFonts, string> = {
  display: '/assets/fonts/Baloo2-ExtraBold.ttf',
  sans: '/assets/fonts/NunitoSans-SemiBold.ttf',
  sansBold: '/assets/fonts/NunitoSans-Bold.ttf',
};

export const ROUND_LABEL_MM = 70;
export const SQUARE_LABEL_MM = 120;

interface Palette {
  label: string;
  bg: string;
  /** Headings and the wordmark. */
  text: string;
  /** Body copy and eyebrows. */
  muted: string;
  /** The "Zack" half of the wordmark. */
  accent: string;
  /** The stitched border and bullets. */
  stitch: string;
  /** Fill behind the weight / material cells. */
  panel: string;
  /** The mark sits on its forest tile everywhere but on forest itself. */
  markTile: boolean;
}

/*
 * The brand rule holds on a sticker too: lemon and mint are fills, never
 * text. Bright and light grounds take ink; only forest takes cream.
 */
export const COLOURWAYS = {
  forest: {
    label: 'Forest',
    bg: '#005247',
    text: '#FBF1CA',
    muted: '#CFE3DE',
    accent: '#FFEB6C',
    stitch: '#21FFA8',
    panel: '#003B33',
    markTile: false,
  },
  cream: {
    label: 'Cream',
    bg: '#FBF1CA',
    text: '#003B33',
    muted: '#2E6A60',
    accent: '#00695C',
    stitch: '#005247',
    panel: '#F5E7B8',
    markTile: true,
  },
  lemon: {
    label: 'Lemon',
    bg: '#FFEB6C',
    text: '#003B33',
    muted: '#005247',
    accent: '#00695C',
    stitch: '#005247',
    panel: '#FFF4A6',
    markTile: true,
  },
  mint: {
    label: 'Mint',
    bg: '#21FFA8',
    text: '#003B33',
    muted: '#005247',
    accent: '#00695C',
    stitch: '#005247',
    panel: '#A8FFDC',
    markTile: true,
  },
  white: {
    label: 'White',
    bg: '#FFFFFF',
    text: '#003B33',
    muted: '#2E6A60',
    accent: '#00695C',
    stitch: '#005247',
    panel: '#E4F1EE',
    markTile: true,
  },
} satisfies Record<string, Palette>;

export type Colourway = keyof typeof COLOURWAYS;

export const isColourway = (value: unknown): value is Colourway =>
  typeof value === 'string' && value in COLOURWAYS;

export interface LabelOptions {
  colourway?: Colourway;
  /** Background carried past the cut line on every side, in mm. */
  bleedMm?: number;
}

export interface RoundLabelInput extends LabelOptions {
  /** Arched over the logo. */
  message: string;
  /** Arched under it. Empty leaves the arc bare. */
  tagline?: string;
}

export interface SquareLabelInput extends LabelOptions {
  bundleName: string;
  /** One entry per line on the label. */
  items: string[];
  totalWeight?: string;
  material?: string;
}

export interface Label {
  svg: string;
  /** Finished size including bleed — the label is always square. */
  sizeMm: number;
  /** Things that did not fit, for the form to say out loud. */
  warnings: string[];
}

export const DEFAULT_ROUND_MESSAGE = 'Thank you for your purchase!';
export const DEFAULT_TAGLINE = 'CROCHET BUNDLES & TOOLS';

// ── drawing primitives ─────────────────────────────────────────────────────

const n = (value: number) => String(+value.toFixed(3));

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clean = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

interface TextStyle {
  font: Font;
  size: number;
  /** Letter spacing in em. */
  tracking?: number;
}

function textWidth(text: string, { font, size, tracking = 0 }: TextStyle): number {
  if (!text) return 0;
  // opentype adds the spacing after the last glyph as well; a line does not.
  return font.getAdvanceWidth(text, size, { letterSpacing: tracking }) - tracking * size;
}

type Anchor = 'start' | 'middle' | 'end';

/** One line of outlined text; `y` is the baseline. */
function textPath(text: string, x: number, y: number, style: TextStyle, fill: string, anchor: Anchor = 'start') {
  if (!text) return '';
  const width = textWidth(text, style);
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const d = style.font
    .getPath(text, left, y, style.size, { letterSpacing: style.tracking ?? 0 })
    .toPathData(3);
  return d ? `<path fill="${fill}" d="${d}"/>` : '';
}

/** Split a word that is wider than a whole line into pieces that fit. */
function breakWord(word: string, style: TextStyle, maxWidth: number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const char of word) {
    if (piece && textWidth(piece + char, style) > maxWidth) {
      pieces.push(piece);
      piece = char;
    } else {
      piece += char;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Greedy word wrap. A word wider than the line is broken across lines. */
function wrap(text: string, style: TextStyle, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  const words = text
    .split(' ')
    .filter(Boolean)
    .flatMap((word) => (textWidth(word, style) > maxWidth ? breakWord(word, style, maxWidth) : [word]));
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, style) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Cut a line to fit, ending in an ellipsis. */
function truncate(text: string, style: TextStyle, maxWidth: number): string {
  if (textWidth(text, style) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, style) > maxWidth) cut = cut.slice(0, -1).trimEnd();
  return `${cut}…`;
}

/** Keep the first `max` lines, folding the overflow into an ellipsis on the last. */
function clamp(lines: string[], max: number, style: TextStyle, maxWidth: number): string[] {
  const kept = lines.slice(0, max - 1);
  kept.push(lines.slice(max - 1).join(' '));
  return kept.map((line) => truncate(line, style, maxWidth));
}

const capHeight = (font: Font, size: number) =>
  (((font.tables.os2 as { sCapHeight?: number } | undefined)?.sCapHeight ?? font.unitsPerEm * 0.7) /
    font.unitsPerEm) *
  size;

function pathData(path: Path, map: (x: number, y: number) => [number, number]): string {
  const p = (x: number, y: number) => map(x, y).map(n).join(' ');
  return path.commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${p(c.x, c.y)}`;
        case 'Q':
          return `Q${p(c.x1, c.y1)} ${p(c.x, c.y)}`;
        case 'C':
          return `C${p(c.x1, c.y1)} ${p(c.x2, c.y2)} ${p(c.x, c.y)}`;
        default:
          return 'Z';
      }
    })
    .join('');
}

/** Width of text set on a curve, where kerning is applied pair by pair. */
function arcAdvances(text: string, { font, size, tracking = 0 }: TextStyle) {
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  const advances = glyphs.map((glyph, i) => {
    const kern = i < glyphs.length - 1 ? font.getKerningValue(glyph, glyphs[i + 1]) : 0;
    const spacing = i < glyphs.length - 1 ? tracking * size : 0;
    return ((glyph.advanceWidth ?? 0) + kern) * scale + spacing;
  });
  return { glyphs, advances, width: advances.reduce((sum, a) => sum + a, 0) };
}

/*
 * Text set around a circle, centred on 12 o'clock ('top') or 6 o'clock
 * ('bottom'). `radius` is the baseline's. Each glyph is rotated about the
 * middle of its own advance, and the rotation is baked into the outline so
 * the result is one plain path with no transforms to get lost in an import.
 */
function arcText(
  text: string,
  cx: number,
  cy: number,
  radius: number,
  style: TextStyle,
  fill: string,
  side: 'top' | 'bottom',
): string {
  const { glyphs, advances, width } = arcAdvances(text, style);
  const glyphScale = style.size / style.font.unitsPerEm;
  let cursor = -width / 2;
  let d = '';

  glyphs.forEach((glyph, i) => {
    const glyphWidth = (glyph.advanceWidth ?? 0) * glyphScale;
    const angle = (cursor + glyphWidth / 2) / radius;
    const turn = side === 'top' ? angle : -angle;
    const ox = cx + radius * Math.sin(angle);
    const oy = side === 'top' ? cy - radius * Math.cos(angle) : cy + radius * Math.cos(angle);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    d += pathData(glyph.getPath(-glyphWidth / 2, 0, style.size), (x, y) => [
      ox + x * cos - y * sin,
      oy + x * sin + y * cos,
    ]);
    cursor += advances[i];
  });

  return d ? `<path fill="${fill}" d="${d}"/>` : '';
}

/**
 * The ZippyZack mark, centred on (cx, cy) and `size` mm across. On its tile
 * it is the favicon; without, the forest ground of the label is the tile.
 */
function mark(cx: number, cy: number, size: number, tile: boolean): string {
  // The artwork is drawn on a 64-unit tile; the bare mark is 51 units across.
  const scale = size / (tile ? 64 : 51);
  return (
    `<g transform="translate(${n(cx)} ${n(cy)}) scale(${n(scale)})">` +
    (tile ? '<rect x="-32" y="-32" width="64" height="64" rx="16" fill="#005247"/>' : '') +
    '<rect x="-23" y="-23" width="46" height="46" rx="6" fill="none" stroke="#21FFA8" stroke-width="5" stroke-linejoin="round"/>' +
    '<rect x="-15" y="-15" width="30" height="30" rx="4" fill="#FFEB6C" stroke="#FFEB6C" stroke-width="5" stroke-linejoin="round" transform="rotate(45)"/>' +
    '<path fill="none" stroke="#003B33" stroke-width="2.9" d="M-10 -6H-1.3L-10 6H-1.3M1.3 -6H10L1.3 6H10"/>' +
    '</g>'
  );
}

/** "ZippyZack" in two colours; `y` is the baseline. Returns the drawn width too. */
function wordmark(x: number, y: number, size: number, fonts: LabelFonts, palette: Palette, anchor: Anchor) {
  const style: TextStyle = { font: fonts.display, size, tracking: -0.012 };
  const width = textWidth('ZippyZack', style);
  const left = anchor === 'middle' ? x - width / 2 : x;
  // Measured as one word so the join between the halves keeps its kerning.
  const split = width - textWidth('Zack', style);
  return {
    width,
    svg: textPath('Zippy', left, y, style, palette.text) + textPath('Zack', left + split, y, style, palette.accent),
  };
}

function svgDocument(title: string, sizeMm: number, bleed: number, body: string): string {
  const full = sizeMm + bleed * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(full)}mm" height="${n(full)}mm" ` +
    `viewBox="${n(-bleed)} ${n(-bleed)} ${n(full)} ${n(full)}">` +
    `<title>${escapeXml(title)}</title>${body}</svg>`
  );
}

const bleedOf = (options: LabelOptions) => Math.min(Math.max(options.bleedMm ?? 0, 0), 10);
const paletteOf = (options: LabelOptions): Palette => COLOURWAYS[options.colourway ?? 'forest'];

// ── round: thank-you sticker ───────────────────────────────────────────────

/** A 7 cm round sticker: the logo, with a message arched over it. */
export function buildRoundLabel(input: RoundLabelInput, fonts: LabelFonts): Label {
  const palette = paletteOf(input);
  const bleed = bleedOf(input);
  const warnings: string[] = [];
  const size = ROUND_LABEL_MM;
  const c = size / 2;
  // The lettering runs in a band centred on this radius, inside the stitching.
  const band = 27.3;

  const message = clean(input.message);
  const tagline = clean(input.tagline).toUpperCase();

  const fitArc = (text: string, style: TextStyle, minSize: number, maxDegrees: number) => {
    const fitted = { ...style };
    const maxArc = (maxDegrees * Math.PI) / 180;
    while (fitted.size > minSize && arcAdvances(text, fitted).width / band > maxArc) fitted.size -= 0.1;
    return { style: fitted, fits: arcAdvances(text, fitted).width / band <= maxArc };
  };

  let body =
    `<circle cx="${n(c)}" cy="${n(c)}" r="${n(c + bleed)}" fill="${palette.bg}"/>` +
    `<circle cx="${n(c)}" cy="${n(c)}" r="32.4" fill="none" stroke="${palette.stitch}" ` +
    'stroke-width="0.45" stroke-linecap="round" stroke-dasharray="1.7 1.35"/>';

  // The message takes the top of the circle, and more of it when it has the
  // circle to itself.
  if (message) {
    const { style, fits } = fitArc(message, { font: fonts.display, size: 5.2 }, 3, tagline ? 205 : 300);
    if (!fits) warnings.push('The message is too long to arch around the sticker — shorten it.');
    body += arcText(message, c, c, band - capHeight(style.font, style.size) / 2, style, palette.text, 'top');
  }
  if (tagline) {
    const { style, fits } = fitArc(tagline, { font: fonts.sansBold, size: 2.9, tracking: 0.2 }, 2, 105);
    if (!fits) warnings.push('The bottom text is too long — shorten it.');
    body += arcText(tagline, c, c, band + capHeight(style.font, style.size) / 2, style, palette.muted, 'bottom');
  }

  body += mark(c, 28.2, palette.markTile ? 20 : 17.5, palette.markTile);
  body += wordmark(c, 47.4, 7.6, fonts, palette, 'middle').svg;

  return { svg: svgDocument(message || 'ZippyZack sticker', size, bleed, body), sizeMm: size + bleed * 2, warnings };
}

// ── square: bundle label ───────────────────────────────────────────────────

interface ListLayout {
  size: number;
  columns: string[][][];
  columnWidth: number;
}

const LIST_LINE = 1.32;
const LIST_ITEM_GAP = 0.42;
const LIST_COLUMN_GAP = 5;
const listIndent = (size: number) => size * 0.95;

/** Height of a column of wrapped items at a given type size. */
const columnHeight = (column: string[][], size: number) =>
  column.reduce((h, lines) => h + lines.length * size * LIST_LINE, 0) +
  Math.max(column.length - 1, 0) * size * LIST_ITEM_GAP;

/*
 * Fit the item list into its box: one column while the type stays a
 * comfortable size, two once it would not. Returns null if even the smallest
 * two-column setting overflows.
 */
function layoutList(items: string[], font: Font, width: number, height: number): ListLayout | null {
  const attempt = (columnCount: number, size: number): ListLayout | null => {
    const columnWidth = (width - LIST_COLUMN_GAP * (columnCount - 1)) / columnCount;
    const wrapped = items.map((item) => wrap(item, { font, size }, columnWidth - listIndent(size)));
    const columns: string[][][] = [];
    if (columnCount === 1) {
      columns.push(wrapped);
    } else {
      // Break where the two columns come out closest to level.
      let best = 1;
      let bestHeight = Infinity;
      for (let i = 1; i < wrapped.length; i++) {
        const tallest = Math.max(columnHeight(wrapped.slice(0, i), size), columnHeight(wrapped.slice(i), size));
        if (tallest < bestHeight) {
          bestHeight = tallest;
          best = i;
        }
      }
      columns.push(wrapped.slice(0, best), wrapped.slice(best));
    }
    return columns.every((column) => columnHeight(column, size) <= height) ? { size, columns, columnWidth } : null;
  };

  const sizes = (from: number, to: number) => {
    const out: number[] = [];
    for (let s = from; s >= to - 1e-9; s -= 0.2) out.push(+s.toFixed(1));
    return out;
  };

  for (const size of sizes(4.6, 3.6)) {
    const fit = attempt(1, size);
    if (fit) return fit;
  }
  if (items.length > 1) {
    // Narrow columns wrap early, and "50 / g" is worse than slightly smaller
    // type — so take a setting where nothing wraps if there is a readable one.
    for (const size of sizes(4.6, 3.4)) {
      const fit = attempt(2, size);
      if (fit?.columns.every((column) => column.every((lines) => lines.length === 1))) return fit;
    }
    for (const size of sizes(4.6, 2.6)) {
      const fit = attempt(2, size);
      if (fit) return fit;
    }
  }
  for (const size of sizes(3.4, 2.6)) {
    const fit = attempt(1, size);
    if (fit) return fit;
  }
  return null;
}

/** A 12 cm square sticker listing what is in a bundle. */
export function buildSquareLabel(input: SquareLabelInput, fonts: LabelFonts): Label {
  const palette = paletteOf(input);
  const bleed = bleedOf(input);
  const warnings: string[] = [];
  const size = SQUARE_LABEL_MM;
  const left = 11;
  const right = size - 11;
  const width = right - left;

  const bundleName = clean(input.bundleName);
  const items = input.items.map(clean).filter(Boolean);
  const totalWeight = clean(input.totalWeight);
  const material = clean(input.material);

  const eyebrowStyle: TextStyle = { font: fonts.sansBold, size: 2.5, tracking: 0.18 };
  const eyebrow = (text: string, x: number, y: number) => textPath(text, x, y, eyebrowStyle, palette.muted);

  let body =
    `<rect x="${n(-bleed)}" y="${n(-bleed)}" width="${n(size + bleed * 2)}" height="${n(size + bleed * 2)}" fill="${palette.bg}"/>` +
    `<rect x="4.5" y="4.5" width="${n(size - 9)}" height="${n(size - 9)}" rx="3.5" fill="none" stroke="${palette.stitch}" ` +
    'stroke-width="0.45" stroke-linecap="round" stroke-dasharray="1.7 1.35"/>';

  // Header: the lockup, left-aligned like everything under it.
  const markSize = palette.markTile ? 14 : 12.5;
  body += mark(left + markSize / 2, 18, markSize, palette.markTile);
  const lockupX = left + markSize + 3.4;
  body += wordmark(lockupX, 19.4, 8.6, fonts, palette, 'start').svg;
  body += textPath(DEFAULT_TAGLINE, lockupX + 0.3, 23.6, { font: fonts.sans, size: 2.3, tracking: 0.22 }, palette.muted);
  body += `<path d="M${n(left)} 29.5H${n(right)}" stroke="${palette.stitch}" stroke-width="0.3" opacity="0.45"/>`;

  // Bundle name: on one line if it can be without getting small — that
  // leaves the list the most room — and otherwise on two.
  const dividerY = 29.5;
  const nameStyle: TextStyle = { font: fonts.display, size: 8 };
  let nameLines = wrap(bundleName, nameStyle, width);
  const shrinkName = (from: number, to: number, maxLines: number) => {
    for (let s = from; s >= to; s -= 0.25) {
      nameStyle.size = s;
      nameLines = wrap(bundleName, nameStyle, width);
      if (nameLines.length <= maxLines) return true;
    }
    return false;
  };
  if (!shrinkName(8, 6.5, 1) && !shrinkName(7.5, 5, 2)) {
    warnings.push('The bundle name is too long for two lines, so it has been cut short.');
    nameLines = clamp(nameLines, 2, nameStyle, width);
  }
  let y = dividerY;
  if (nameLines.length) {
    y += 5.4 + capHeight(nameStyle.font, nameStyle.size);
    nameLines.forEach((line, i) => {
      if (i) y += nameStyle.size * 0.98;
      body += textPath(line, left, y, nameStyle, palette.text);
    });
    // Baloo's descender is deep; leave it room before the next block.
    y += nameStyle.size * 0.42;
  }

  // Footer: weight and material, in panels along the bottom. Either can be
  // left out, and with neither the list runs to the bottom. Nothing in a
  // panel is cut short: a long material wraps, and the panels grow upwards
  // to hold it, taking the room from the item list.
  const footerBottom = size - 10.5;
  const cellGap = 3;
  const cellPad = 3.4;
  const valueTop = 8.75; // from the top of the panel to the top of the value
  const valueLine = 1.25;
  const cap = (style: TextStyle) => capHeight(style.font, style.size);
  // The tallest the panels may get: up to the name, less a gap.
  const footerMax = footerBottom - y - 4;

  const specs: { label: string; value: string; share: number }[] = [];
  if (totalWeight) specs.push({ label: 'TOTAL WEIGHT', value: totalWeight, share: material ? 0.36 : 1 });
  if (material) specs.push({ label: 'MATERIAL', value: material, share: totalWeight ? 0.64 : 1 });

  const cells = specs.map((spec) => {
    const cellWidth = (width - cellGap * (specs.length - 1)) * spec.share;
    const inner = cellWidth - cellPad * 2;
    const style: TextStyle = { font: fonts.sansBold, size: 5 };
    const heightOf = (lineCount: number) =>
      valueTop + cap(style) + style.size * valueLine * (lineCount - 1) + cellPad;

    // One line if it fits at a readable size; otherwise wrapped, getting
    // smaller only once the panel would outgrow the label.
    while (style.size > 3.8 && textWidth(spec.value, style) > inner) style.size = +(style.size - 0.2).toFixed(1);
    let lines = [spec.value];
    if (textWidth(spec.value, style) > inner) {
      style.size = 3.5;
      lines = wrap(spec.value, style, inner);
      while (style.size > 2.4 && heightOf(lines.length) > footerMax) {
        style.size = +(style.size - 0.1).toFixed(1);
        lines = wrap(spec.value, style, inner);
      }
      if (heightOf(lines.length) > footerMax) {
        // Only reachable with several hundred characters.
        warnings.push(
          `${spec.label === 'MATERIAL' ? 'The material' : 'The total weight'} is too long for the label even at the smallest size, so it has been cut short.`,
        );
        let keep = lines.length;
        while (keep > 1 && heightOf(keep) > footerMax) keep--;
        lines = clamp(lines, keep, style, inner);
      }
    }
    return { ...spec, cellWidth, style, lines, height: heightOf(lines.length) };
  });

  const footerHeight = Math.max(17, ...cells.map((cell) => cell.height));
  const footerTop = footerBottom - footerHeight;
  let cellX = left;
  for (const cell of cells) {
    body += `<rect x="${n(cellX)}" y="${n(footerTop)}" width="${n(cell.cellWidth)}" height="${n(footerHeight)}" rx="2.6" fill="${palette.panel}"/>`;
    body += eyebrow(cell.label, cellX + cellPad, footerTop + 5.4);
    let valueY = footerTop + valueTop + cap(cell.style);
    for (const line of cell.lines) {
      body += textPath(line, cellX + cellPad, valueY, cell.style, palette.text);
      valueY += cell.style.size * valueLine;
    }
    cellX += cell.cellWidth + cellGap;
  }

  // The item list takes whatever is left between the name and the footer.
  if (items.length) {
    y += 3.6;
    const listLabelY = y;
    const listTop = y + 3.2;
    const listBottom = cells.length ? footerTop - 4.5 : footerBottom;
    const available = listBottom - listTop;

    let layout = layoutList(items, fonts.sans, width, available);
    let shown = items;
    if (!layout) {
      // Keep as many items as fit alongside a line saying how many went.
      const withRest = (count: number) =>
        layoutList([...items.slice(0, count), `+ ${items.length - count} more`], fonts.sans, width, available);
      let low = 1;
      let high = items.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const fit = withRest(middle);
        if (fit) {
          layout = fit;
          shown = items.slice(0, middle);
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (layout) {
        warnings.push(
          `Only ${shown.length} of ${items.length} items fit — the rest are summed up as “+ ${items.length - shown.length} more”.`,
        );
      } else {
        warnings.push('The item list does not fit on the label — shorten it.');
      }
    }

    if (layout) {
      body += eyebrow("WHAT'S INSIDE", left, listLabelY);
      const { size: itemSize, columns, columnWidth } = layout;
      const style: TextStyle = { font: fonts.sans, size: itemSize };
      const itemCap = capHeight(fonts.sans, itemSize);
      columns.forEach((column, columnIndex) => {
        const x = left + columnIndex * (columnWidth + LIST_COLUMN_GAP);
        let lineY = listTop;
        for (const lines of column) {
          // A diamond from the mark for a bullet, level with the first line.
          const h = itemSize * 0.24;
          const by = lineY + itemSize * LIST_LINE * 0.5;
          const bx = x + h;
          body += `<path fill="${palette.stitch}" d="M${n(bx)} ${n(by - h)}L${n(bx + h)} ${n(by)}L${n(bx)} ${n(by + h)}L${n(bx - h)} ${n(by)}Z"/>`;
          for (const line of lines) {
            const baseline = lineY + itemSize * LIST_LINE * 0.5 + itemCap / 2;
            body += textPath(line, x + listIndent(itemSize), baseline, style, palette.text);
            lineY += itemSize * LIST_LINE;
          }
          lineY += itemSize * LIST_ITEM_GAP;
        }
      });
    }
  }

  return { svg: svgDocument(bundleName || 'ZippyZack bundle label', size, bleed, body), sizeMm: size + bleed * 2, warnings };
}

// ── export helpers ─────────────────────────────────────────────────────────

export const DPI_CHOICES = [300, 600, 1200] as const;

export const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

/** The same drawing sized in pixels, for rasterising at an exact resolution. */
export function svgAtPixelSize(svg: string, px: number): string {
  return svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${px}" height="${px}"`);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/*
 * A canvas writes a PNG with no physical size, so print software assumes
 * 72 or 96 dpi and the sticker opens several times too large. This adds the
 * pHYs chunk that says how many pixels make a metre, straight after IHDR.
 */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const IHDR_END = 33; // 8-byte signature + 25-byte IHDR chunk
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, IHDR_END), 0);
  out.set(chunk, IHDR_END);
  out.set(png.subarray(IHDR_END), IHDR_END + chunk.length);
  return out;
}

/** A filename-safe version of whatever the label is called. */
export const labelSlug = (value: string, fallback: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || fallback;
