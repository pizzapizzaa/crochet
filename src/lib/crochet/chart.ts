/*
 * Crochet symbol charts, drawn the way published patterns draw them.
 *
 * The symbols are the Craft Yarn Council's: an oval for a chain, a dot for a
 * slip stitch, an X for single crochet, a T for half double, and a T with one
 * or two slashes across the post for double and treble. A stitch is as tall
 * as the turning chain that stands in for it — one chain for sc, two for hdc,
 * three for dc, four for tr — which is what lets a chart be read by eye.
 *
 * The model is deliberately physical. Every stitch is worked *into* something
 * in the row below, and starts on top of it: a shell's five posts all rise
 * out of one stitch, and the single crochet between shells sits on the centre
 * of the shell beneath. Charts built this way come out with the wavy, nested
 * shapes real ones have, rather than a grid of symbols on flat lines.
 *
 * Coordinates are in chart units: x counts foundation chains from the left,
 * y counts chain-heights up from the foundation. The renderer scales them.
 */

export type StitchKind = 'ch' | 'slst' | 'sc' | 'hdc' | 'dc' | 'tr' | 'tss' | 'ret';

/** Stitch heights, in chains — the same as the turning chain each one needs. */
export const HEIGHT: Record<'sc' | 'hdc' | 'dc' | 'tr', number> = { sc: 1, hdc: 2, dc: 3, tr: 4 };

export interface Mark {
  kind: StitchKind;
  /** Row or round, for colour. 0 is the foundation. */
  row: number;
  /** Base and top of a post; for a chain or slip stitch only (x1, y1) is used. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** A chain lying along the row, or standing up as part of a turning chain. */
  orient?: 'along' | 'up';
  /** For a chain in a round chart: the angle of the row it lies along, in degrees. */
  angle?: number;
}

export interface RowLabel {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'end' | 'middle';
  row: number;
}

export interface Chart {
  marks: Mark[];
  labels: RowLabel[];
  /** A bracket along the bottom showing the pattern repeat. */
  repeat?: { x1: number; x2: number; label: string };
  /** An arrow from a label at (fromX, fromY) to where the work begins. */
  start?: { x: number; y: number; fromX: number; fromY: number; label: string };
  kinds: StitchKind[];
}

/* ── Building flat charts, row by row ─────────────────────────────── */

/**
 * The top of whatever sits in each column, so the next row knows where each
 * of its stitches starts. Columns are foundation chains; a stitch whose top
 * leans into another column (a shell's fan) moves that column's top with it.
 */
export class RowChartBuilder {
  readonly marks: Mark[] = [];
  readonly labels: RowLabel[] = [];
  private tops: Map<number, number> = new Map();
  /** The row that last worked each column, to tell a live edge from a stale one. */
  private worked: Map<number, number> = new Map();
  private next: Map<number, number> = new Map();
  private row = 0;
  private direction: 'rtl' | 'ltr' = 'rtl';
  private rowStartTop = 0;

  constructor(readonly columns: number) {}

  /**
   * The foundation chain, `count` chains along the bottom from the left. The
   * chains skipped at the start of row 1 are drawn by row 1 as its turning
   * chain, standing up at the right-hand end the way charts show them.
   */
  foundation(count: number): void {
    for (let x = 0; x < count; x += 1) {
      this.marks.push({ kind: 'ch', row: 0, x1: x, y1: 0, x2: x, y2: 0, orient: 'along' });
      this.tops.set(x, 0.2);
    }
  }

  /**
   * Start a row. Odd rows travel right to left, even rows back — unless the
   * work is never turned, as in Tunisian crochet, where every forward pass
   * starts at the right.
   */
  beginRow(row: number, turned = true): void {
    this.row = row;
    this.direction = !turned || row % 2 === 1 ? 'rtl' : 'ltr';
    this.next = new Map();
    this.rowStartTop = Math.max(...this.tops.values());
  }

  /** The column a row starts from. */
  get startColumn(): number {
    return this.direction === 'rtl' ? this.columns - 1 : 0;
  }

  /** Where the column's last stitch ended, so the next one can start on it. */
  topOf(column: number): number {
    return this.tops.get(column) ?? this.rowStartTop;
  }

  /** A turning chain standing up at the start of the row. */
  turningChain(count: number, counts: boolean): void {
    const column = this.startColumn;
    const x = counts ? column : column + (this.direction === 'rtl' ? 0.9 : -0.9);
    // A turning chain rises from the end of the row below. When the edge
    // column itself was last worked rows ago — moss rows end one column in —
    // that is the nearest column the row below did work.
    let base = this.topOf(column);
    if ((this.worked.get(column) ?? 0) < this.row - 1) {
      const live = [...this.worked].filter(([, r]) => r === this.row - 1).map(([c]) => c);
      if (live.length) {
        const nearest = live.reduce((a, c) => (Math.abs(c - column) < Math.abs(a - column) ? c : a));
        base = this.topOf(nearest);
      }
    }
    this.stack(x, base, count, this.row);
    if (counts) this.next.set(column, base + count);
    this.labelAt(x, base + count / 2);
  }

  /** A stitch worked into `into`, its top at `at` (the same column unless it fans). */
  stitch(kind: 'sc' | 'hdc' | 'dc' | 'tr' | 'tss', into: number, at = into): void {
    const base = this.topOf(into);
    const height = kind === 'tss' ? 1 : HEIGHT[kind];
    // A leaning post keeps its length, so a fan's outer stitches are as tall as
    // its middle one, and lean out rather than stretching.
    const dx = at - into;
    const rise = Math.sqrt(Math.max(height * height - dx * dx * 0.5, height * height * 0.6));
    this.marks.push({ kind, row: this.row, x1: into, y1: base, x2: at, y2: base + rise });
    this.next.set(at, Math.max(this.next.get(at) ?? 0, base + rise));
  }

  /** Several stitches into one stitch, fanned evenly either side of it. */
  fan(kind: 'sc' | 'hdc' | 'dc' | 'tr', into: number, count: number, spread = 1): void {
    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * spread;
      this.stitch(kind, into, into + offset);
    }
  }

  /** A chain lying along the row at `at`, level with the stitches either side. */
  chain(at: number, level?: number): void {
    const y = level ?? Math.max(this.next.get(at - 1) ?? 0, this.next.get(at + 1) ?? 0, this.topOf(at) + 0.6);
    this.marks.push({ kind: 'ch', row: this.row, x1: at, y1: y, x2: at, y2: y, orient: 'along' });
    this.next.set(at, y + 0.2);
  }

  /**
   * A space the next row works into without anything being drawn there — the
   * turning chain at a row's edge, which the last stitch of the next row goes
   * into.
   */
  space(at: number, level: number): void {
    this.next.set(at, level);
  }

  /** The level the row's stitches have reached so far, for chains laid along it. */
  get level(): number {
    return this.next.size ? Math.max(...this.next.values()) : this.rowStartTop;
  }

  /** A Tunisian return pass: the chain of loops worked off along the top of the row. */
  returnPass(from: number, to: number, level: number): void {
    this.marks.push({ kind: 'ret', row: this.row, x1: from, y1: level, x2: to, y2: level });
  }

  /** Close the row: the tops it made become what the next row works into. */
  endRow(): void {
    for (const [column, top] of this.next) {
      this.tops.set(column, top);
      this.worked.set(column, this.row);
    }
  }

  private stack(x: number, base: number, count: number, row: number): void {
    for (let i = 0; i < count; i += 1) {
      this.marks.push({ kind: 'ch', row, x1: x, y1: base + 0.5 + i, x2: x, y2: base + 0.5 + i, orient: 'up' });
    }
  }

  /** The row's number, just outside where the row starts. */
  labelAt(x: number, y: number): void {
    const rtl = this.direction === 'rtl';
    this.labels.push({ text: String(this.row), x: x + (rtl ? 0.9 : -0.9), y, anchor: rtl ? 'start' : 'end', row: this.row });
  }

  build(kinds: StitchKind[], extra: Partial<Chart> = {}): Chart {
    return { marks: this.marks, labels: this.labels, kinds, ...extra };
  }
}

/* ── Rendering ────────────────────────────────────────────────────── */

const INK = '#1F2A2A';
const BLUE = '#2A7AB0';
const PAPER = '#FFFDF2';
const MUTED = '#2E6A60';
const ACCENT = '#C0392B';
const FONT = "'Nunito Sans', ui-sans-serif, system-ui, sans-serif";

/** Alternate rows in two colours, as printed charts do, so a row can be followed by eye. */
const colourOf = (row: number) => (row === 0 || row % 2 === 1 ? INK : BLUE);

const f = (n: number) => (Math.round(n * 10) / 10).toString();

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Frame {
  /** Chart units to pixels, horizontally and vertically. */
  ux: number;
  uy: number;
  /** Where chart (0, 0) lands, in pixels. */
  ox: number;
  oy: number;
}

const px = (fr: Frame, x: number) => fr.ox + x * fr.ux;
const py = (fr: Frame, y: number) => fr.oy - y * fr.uy;

/** One symbol, in pixels. Posts are drawn from base to top along their own lean. */
export function symbolSvg(
  kind: StitchKind,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: string,
  size: number,
  orient: 'along' | 'up' = 'along',
  angle = 0,
): string {
  const stroke = `stroke="${colour}" stroke-width="${f(Math.max(size * 0.09, 1.1))}" stroke-linecap="round" fill="none"`;

  if (kind === 'ch') {
    const rot = orient === 'up' ? 90 + angle : angle;
    return `<ellipse cx="${f(x1)}" cy="${f(y1)}" rx="${f(size * 0.4)}" ry="${f(size * 0.17)}" transform="rotate(${f(rot)} ${f(x1)} ${f(y1)})" ${stroke} />`;
  }
  if (kind === 'slst') {
    return `<circle cx="${f(x1)}" cy="${f(y1)}" r="${f(size * 0.13)}" fill="${colour}" />`;
  }

  // Unit vectors along the post and across it.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ax = dx / len;
  const ay = dy / len;
  const cx = -ay;
  const cy = ax;

  if (kind === 'sc') {
    // An X centred on the post, a chain-height tall.
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const r = Math.min(len, size) * 0.36;
    const p = (s: number, t: number) => `${f(mx + ax * s + cx * t)},${f(my + ay * s + cy * t)}`;
    return `<path d="M${p(-r, -r)}L${p(r, r)}M${p(-r, r)}L${p(r, -r)}" ${stroke} />`;
  }

  if (kind === 'ret') {
    // The return pass: a tilde running the length of the row.
    const width = x2 - x1;
    const waves = Math.max(2, Math.round(Math.abs(width) / size));
    const step = width / waves;
    const amp = size * 0.12;
    let d = `M${f(x1)},${f(y1)}`;
    for (let i = 0; i < waves; i += 1) {
      const sx = x1 + step * i;
      d += `C${f(sx + step * 0.3)},${f(y1 - amp * 2)} ${f(sx + step * 0.7)},${f(y1 + amp * 2)} ${f(sx + step)},${f(y1)}`;
    }
    return `<path d="${d}" ${stroke} />`;
  }

  if (kind === 'tss') {
    // Tunisian simple stitch: an upright bar, the vertical loop it is worked through.
    return `<line x1="${f(x1)}" y1="${f(y1 + (y2 - y1) * 0.15)}" x2="${f(x2)}" y2="${f(y2 - (y2 - y1) * 0.15)}" ${stroke} />`;
  }

  // hdc, dc, tr: a post with a bar across the top, and slashes for each yarn-over wrap.
  const bar = size * 0.3;
  const top = `M${f(x2 - cx * bar)},${f(y2 - cy * bar)}L${f(x2 + cx * bar)},${f(y2 + cy * bar)}`;
  const post = `M${f(x1)},${f(y1)}L${f(x2)},${f(y2)}`;
  const slashes = kind === 'dc' ? [0.5] : kind === 'tr' ? [0.42, 0.62] : [];
  const slash = slashes
    .map((t) => {
      const sx = x1 + dx * t;
      const sy = y1 + dy * t;
      const w = size * 0.15;
      // Tilted against the post, the way the symbol is printed.
      return `M${f(sx - cx * w - ax * w * 0.55)},${f(sy - cy * w - ay * w * 0.55)}L${f(sx + cx * w + ax * w * 0.55)},${f(sy + cy * w + ay * w * 0.55)}`;
    })
    .join('');
  return `<path d="${post}${top}${slash}" ${stroke} />`;
}

/**
 * The chart's marks and labels, fitted into a box at (left, top) no wider
 * than `width` and no taller than `height`, centred across and set at the
 * top. Returns the height it actually used, so what follows can sit under it.
 */
export function chartSvg(
  chart: Chart,
  box: { left: number; top: number; width: number; height: number },
): { svg: string; height: number } {
  const xs = chart.marks.flatMap((m) => [m.x1, m.x2]).concat(chart.labels.map((l) => l.x));
  const ys = chart.marks.flatMap((m) => [m.y1, m.y2]).concat(chart.labels.map((l) => l.y));
  if (chart.start) {
    xs.push(chart.start.fromX);
    ys.push(chart.start.fromY);
  }
  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - (chart.repeat ? 1.4 : 0.8);
  const maxY = Math.max(...ys) + 0.6;

  // Chains read best a little wider than a chain-height is tall.
  const unit = Math.min(box.width / (maxX - minX), (box.height / (maxY - minY)) * 1.1, 34);
  const fr: Frame = {
    ux: unit,
    uy: unit / 1.1,
    ox: box.left + (box.width - (maxX - minX) * unit) / 2 - minX * unit,
    oy: box.top + maxY * (unit / 1.1),
  };
  const height = (maxY - minY) * (unit / 1.1);

  const parts: string[] = [];
  for (const m of chart.marks) {
    parts.push(
      symbolSvg(m.kind, px(fr, m.x1), py(fr, m.y1), px(fr, m.x2), py(fr, m.y2), colourOf(m.row), unit, m.orient, m.angle ?? 0),
    );
  }
  for (const l of chart.labels) {
    parts.push(
      `<text x="${f(px(fr, l.x))}" y="${f(py(fr, l.y))}" font-size="${f(Math.max(unit * 0.42, 10))}" font-weight="700" fill="${colourOf(l.row)}" text-anchor="${l.anchor}" dominant-baseline="middle">${esc(l.text)}</text>`,
    );
  }
  if (chart.repeat) {
    const { x1, x2, label } = chart.repeat;
    const y = py(fr, -0.55);
    const a = px(fr, x1 - 0.45);
    const b = px(fr, x2 + 0.45);
    parts.push(
      `<path d="M${f(a)},${f(y - 5)}L${f(a)},${f(y)}L${f(b)},${f(y)}L${f(b)},${f(y - 5)}" stroke="${MUTED}" stroke-width="1.2" fill="none" />` +
        `<text x="${f((a + b) / 2)}" y="${f(y + 13)}" font-size="11" fill="${MUTED}" text-anchor="middle">${esc(label)}</text>`,
    );
  }
  if (chart.start) {
    // A line from the label, outside the chart, in to where the work begins.
    const tx = px(fr, chart.start.x);
    const ty = py(fr, chart.start.y);
    const fx = px(fr, chart.start.fromX);
    const fy = py(fr, chart.start.fromY);
    const len = Math.hypot(tx - fx, ty - fy) || 1;
    const ux = (tx - fx) / len;
    const uy = (ty - fy) / len;
    const hx = tx - ux * 4;
    const hy = ty - uy * 4;
    const head = `${f(hx)},${f(hy)} ${f(hx - ux * 9 - uy * 4)},${f(hy - uy * 9 + ux * 4)} ${f(hx - ux * 9 + uy * 4)},${f(hy - uy * 9 - ux * 4)}`;
    parts.push(
      `<line x1="${f(fx)}" y1="${f(fy)}" x2="${f(hx - ux * 6)}" y2="${f(hy - uy * 6)}" stroke="${ACCENT}" stroke-width="1.6" />` +
        `<polygon points="${head}" fill="${ACCENT}" />` +
        `<text x="${f(fx + 4)}" y="${f(fy + 14)}" font-size="12" fill="${ACCENT}" font-weight="700">${esc(chart.start.label)}</text>`,
    );
  }
  return { svg: parts.join(''), height };
}

/* ── The key ─────────────────────────────────────────────────────── */

export const SYMBOL_NAMES: Record<StitchKind, string> = {
  ch: 'chain (ch)',
  slst: 'slip stitch (sl st)',
  sc: 'single crochet (sc)',
  hdc: 'half double crochet (hdc)',
  dc: 'double crochet (dc)',
  tr: 'treble crochet (tr)',
  tss: 'Tunisian simple stitch (Tss)',
  ret: 'return pass',
};

/** A key of the symbols a chart uses, one per line, at (left, top). Returns its height too. */
export function keySvg(kinds: StitchKind[], left: number, top: number): { svg: string; height: number } {
  const size = 22;
  const row = 26;
  const parts = kinds.map((kind, i) => {
    const y = top + i * row + row / 2;
    const h = kind === 'tss' ? size * 0.4 : kind === 'ch' || kind === 'slst' || kind === 'sc' ? 0 : size * 0.45;
    const symbol =
      kind === 'ch' || kind === 'slst'
        ? symbolSvg(kind, left + 12, y, left + 12, y, INK, size)
        : kind === 'ret'
          ? symbolSvg(kind, left + 2, y, left + 24, y, INK, size)
        : symbolSvg(kind, left + 12, y + (kind === 'sc' ? 7 : h), left + 12, y - (kind === 'sc' ? 7 : h), INK, size);
    return (
      symbol +
      `<text x="${left + 32}" y="${f(y)}" font-size="12" fill="${INK}" dominant-baseline="middle">= ${esc(SYMBOL_NAMES[kind])}</text>`
    );
  });
  return { svg: parts.join(''), height: kinds.length * row };
}

export const CHART_COLOURS = { INK, BLUE, PAPER, MUTED, ACCENT, FONT };
