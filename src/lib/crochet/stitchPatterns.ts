import { HEIGHT, RowChartBuilder } from './chart';
import type { Chart } from './chart';
import { grannyChart } from './rounds';

/*
 * Each stitch pattern the generator offers, as crocheters write and chart it.
 *
 * One definition drives both the written pattern and the chart, so the two
 * cannot disagree: the rows the chart draws are the rows the text describes,
 * stitch for stitch. The foundation is rounded to the pattern's multiple —
 * a shell pattern needs a multiple of 6 plus 2, whatever the gauge says —
 * and the finished width is worked out again from what was actually cast on.
 *
 * Wording follows the Craft Yarn Council's abbreviations and the usual
 * conventions: the turning chain counts as a stitch for dc and tr and not for
 * sc and hdc, "turn" ends each row, and every row ends with its stitch count.
 * The versions of moss, shell and V-stitch are the most common ones; where
 * sources differ, the choice is noted.
 */

export interface PlanInput {
  stitch: string;
  /** Stitches per cm, from the gauge. */
  stitchesPerCm: number;
  /** Rows the piece needs, from the gauge and the stitch's height. */
  rows: number;
  widthCm: number;
  heightCm: number;
}

export interface Plan {
  /** Numbers shown above the pattern: label and value. */
  stats: { label: string; value: string }[];
  /** The foundation chain. Null for a piece started in a ring. */
  foundation: number | null;
  /** Stitches across a row, counting a repeat's skipped chains as stitches. */
  stitchesAcross: number;
  rows: number;
  /** Stitches worked in the whole piece, for the yarn estimate. */
  totalStitches: number;
  finishedWidthCm: number;
  finishedHeightCm: number;
  /** The pattern proper: each entry a heading ("Row 1") and what to do. */
  steps: { heading: string; text: string }[];
  /** Said before the steps — hook, special notes. */
  notes: string[];
  abbreviations: [string, string][];
  chart: Chart;
  chartCaption: string;
  /** For motif patterns, the grid of squares the piece is made from. */
  squares?: { across: number; down: number; rounds: number; sideCm: number };
}

const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${tail}`;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

const ABBR: Record<string, string> = {
  ch: 'chain',
  'sl st': 'slip stitch',
  sc: 'single crochet',
  hdc: 'half double crochet',
  dc: 'double crochet',
  tr: 'treble crochet',
  sk: 'skip',
  sp: 'space',
  'ch-sp': 'chain space',
  st: 'stitch',
  sts: 'stitches',
  tch: 'turning chain',
  rep: 'repeat',
  beg: 'beginning',
  rnd: 'round',
  yo: 'yarn over',
  Tss: 'Tunisian simple stitch',
};

const abbreviations = (...keys: string[]): [string, string][] => keys.map((k) => [k, ABBR[k]]);

/** "Rows 2–40", or "Row 2" when there is only one. */
const range = (from: number, to: number, word = 'Row') => (to > from ? `${word}s ${from}–${to}` : `${word} ${from}`);

/* ── Solid fabric: sc, hdc, dc, tr ────────────────────────────────── */

type Solid = 'sc' | 'hdc' | 'dc' | 'tr';

function solid(kind: Solid, input: PlanInput): Plan {
  const t = HEIGHT[kind];
  // The turning chain stands in for a stitch in dc and tr fabric, not in sc and hdc.
  const counts = kind === 'dc' || kind === 'tr';
  const n = Math.max(3, Math.round(input.stitchesPerCm * input.widthCm));
  const foundation = counts ? n + t - 1 : n + t;
  const rows = Math.max(2, input.rows);

  const row1 = counts
    ? `${cap(kind)} in ${ordinal(t + 1)} ch from hook (the skipped ch count as the first ${kind}) and in each ch across, turn. (${n} ${kind})`
    : `${cap(kind)} in ${ordinal(t + 1)} ch from hook and in each ch across, turn. (${n} ${kind})`;
  const row2 = counts
    ? `Ch ${t} (counts as ${kind}), sk first st, ${kind} in each st across, ${kind} in top of tch, turn. (${n} ${kind})`
    : `Ch ${t} (does not count as a st), ${kind} in each st across, turn. (${n} ${kind})`;

  // The chart: the first ten stitches of four rows.
  const shown = 10;
  const b = new RowChartBuilder(shown);
  b.foundation(counts ? shown - 1 : shown);
  for (let r = 1; r <= 4; r += 1) {
    b.beginRow(r);
    b.turningChain(t, counts);
    const order = r % 2 === 1 ? [...Array(shown).keys()].reverse() : [...Array(shown).keys()];
    for (const c of counts ? order.slice(1) : order) b.stitch(kind, c);
    b.endRow();
  }

  return {
    stats: [
      { label: 'Foundation Chain', value: `ch ${foundation}` },
      { label: 'Total Rows', value: String(rows) },
      { label: 'Stitches per Row', value: String(n) },
    ],
    foundation,
    stitchesAcross: n,
    rows,
    totalStitches: n * rows,
    finishedWidthCm: round1(n / input.stitchesPerCm),
    finishedHeightCm: input.heightCm,
    notes: [],
    steps: [
      { heading: 'Foundation', text: `Ch ${foundation}.` },
      { heading: 'Row 1', text: row1 },
      { heading: 'Row 2', text: row2 },
      ...(rows > 2 ? [{ heading: range(3, rows), text: 'Rep Row 2.' }] : []),
      { heading: 'Finish', text: 'Fasten off and weave in the ends.' },
    ],
    abbreviations: abbreviations('ch', kind, 'st', 'sts', 'sk', 'tch', 'rep'),
    chart: b.build(['ch', kind]),
    chartCaption: `Rows 1–4 across the first ${shown} stitches. Every row is the same, so keep going across all ${n} stitches for ${rows} rows.`,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ── Moss (granite) stitch ────────────────────────────────────────── */

function moss(input: PlanInput): Plan {
  // Ch an even number; the version from Moogly and most modern patterns.
  let foundation = Math.max(6, Math.round(input.stitchesPerCm * input.widthCm));
  if (foundation % 2) foundation += 1;
  const perRow = foundation / 2 - 1;
  const rows = Math.max(2, input.rows);

  const shown = 14;
  const b = new RowChartBuilder(shown);
  b.foundation(shown);
  for (let r = 1; r <= 4; r += 1) {
    b.beginRow(r);
    if (r === 1) {
      // The first three chains are skipped; they become the edge space the
      // last sc of row 2 goes into.
      b.labelAt(shown - 1, 1);
      b.stitch('sc', shown - 4);
      for (let c = shown - 5; c >= 1; c -= 2) {
        b.chain(c);
        b.stitch('sc', c - 1);
      }
      b.space(shown - 2, b.level);
    } else if (r % 2 === 0) {
      // Sc in each ch-1 sp of the row below and ch 1 over each of its sc,
      // then the last sc into the space the row below turned in.
      b.turningChain(2, false);
      for (let c = 1; c <= shown - 5; c += 2) {
        b.stitch('sc', c);
        b.chain(c + 1);
      }
      b.stitch('sc', shown - 2);
      b.space(0, b.level);
    } else {
      b.turningChain(2, false);
      for (let c = shown - 4; c >= 2; c -= 2) {
        b.stitch('sc', c);
        b.chain(c - 1);
      }
      b.stitch('sc', 0);
      b.space(shown - 2, b.level);
    }
    b.endRow();
  }

  return {
    stats: [
      { label: 'Foundation Chain', value: `ch ${foundation}` },
      { label: 'Total Rows', value: String(rows) },
      { label: 'Sc per Row', value: String(perRow) },
    ],
    foundation,
    stitchesAcross: foundation - 2,
    rows,
    totalStitches: (foundation - 2) * rows,
    finishedWidthCm: round1((foundation - 2) / input.stitchesPerCm),
    finishedHeightCm: input.heightCm,
    notes: [],
    steps: [
      { heading: 'Foundation', text: `Ch ${foundation} (an even number).` },
      {
        heading: 'Row 1',
        text: `Sc in 4th ch from hook, *ch 1, sk next ch, sc in next ch; rep from * across, turn. (${perRow} sc)`,
      },
      {
        heading: 'Row 2',
        text: `Ch 2 (does not count as a st), sc in first ch-1 sp, *ch 1, sc in next ch-1 sp; rep from * across, working the last sc into the turning-ch sp, turn. (${perRow} sc)`,
      },
      ...(rows > 2 ? [{ heading: range(3, rows), text: 'Rep Row 2.' }] : []),
      { heading: 'Finish', text: 'Fasten off and weave in the ends.' },
    ],
    abbreviations: abbreviations('ch', 'sc', 'sk', 'ch-sp', 'sp', 'st', 'rep'),
    chart: b.build(['ch', 'sc'], { repeat: { x1: 1, x2: 2, label: 'repeat (2 ch)' } }),
    chartCaption: `Rows 1–4 across ${shown} chains. Each row puts a sc in every ch-1 space and a ch 1 over every sc, so the rows interlock.`,
  };
}

/* ── Shell stitch ─────────────────────────────────────────────────── */

function shell(input: PlanInput): Plan {
  // Multiple of 6 + 2: 5-dc shells separated by sc, with half shells at the
  // edges on even rows so the sides come out straight.
  const shells = Math.max(1, Math.round((input.stitchesPerCm * input.widthCm - 1) / 6));
  const foundation = 6 * shells + 2;
  const rows = Math.max(3, input.rows);

  const k = 3;
  const cols = 6 * k + 1;
  const b = new RowChartBuilder(cols);
  b.foundation(cols);
  for (let r = 1; r <= 4; r += 1) {
    b.beginRow(r);
    if (r % 2 === 1) {
      // Row 1, and every odd row after: sc, then shells and sc alternating.
      b.turningChain(1, false);
      b.stitch('sc', cols - 1);
      for (let i = k - 1; i >= 0; i -= 1) {
        b.fan('dc', 6 * i + 3, 5);
        b.stitch('sc', 6 * i);
      }
    } else {
      // Even rows: a half shell, sc in each shell's centre, full shells in the
      // sc between, and a half shell to finish.
      b.turningChain(3, true);
      b.stitch('dc', 0, 1);
      b.stitch('dc', 0, 2);
      for (let i = 0; i < k - 1; i += 1) {
        b.stitch('sc', 6 * i + 3);
        b.fan('dc', 6 * i + 6, 5);
      }
      b.stitch('sc', 6 * (k - 1) + 3);
      b.stitch('dc', cols - 1, cols - 3);
      b.stitch('dc', cols - 1, cols - 2);
      b.stitch('dc', cols - 1, cols - 1);
    }
    b.endRow();
  }

  const across = 6 * shells + 1;
  return {
    stats: [
      { label: 'Foundation Chain', value: `ch ${foundation}` },
      { label: 'Total Rows', value: String(rows) },
      { label: 'Shells per Row', value: String(shells) },
    ],
    foundation,
    stitchesAcross: across,
    rows,
    totalStitches: across * rows,
    finishedWidthCm: round1(across / input.stitchesPerCm),
    finishedHeightCm: input.heightCm,
    notes: [],
    steps: [
      { heading: 'Foundation', text: `Ch ${foundation} (a multiple of 6, plus 2).` },
      {
        heading: 'Row 1',
        text: `Sc in 2nd ch from hook, *sk 2 ch, 5 dc in next ch, sk 2 ch, sc in next ch; rep from * across, turn. (${shells} shells)`,
      },
      {
        heading: 'Row 2',
        text: `Ch 3 (counts as dc), 2 dc in first sc, *sk 2 dc, sc in next dc, sk 2 dc, 5 dc in next sc; rep from * across to the last shell, sk 2 dc, sc in next dc, sk 2 dc, 3 dc in last sc, turn. (${Math.max(shells - 1, 0)} shells and a half shell at each end)`,
      },
      {
        heading: 'Row 3',
        text: `Ch 1 (does not count as a st), sc in first dc, *sk 2 dc, 5 dc in next sc, sk 2 dc, sc in next dc; rep from * across, working the last sc into the top of the tch, turn. (${shells} shells)`,
      },
      ...(rows > 3 ? [{ heading: range(4, rows), text: 'Rep Rows 2 and 3, ending with a Row 3 if you can for a matching top edge.' }] : []),
      { heading: 'Finish', text: 'Fasten off and weave in the ends.' },
    ],
    abbreviations: abbreviations('ch', 'sc', 'dc', 'sk', 'st', 'tch', 'rep'),
    chart: b.build(['ch', 'sc', 'dc'], { repeat: { x1: 1, x2: 6, label: 'repeat (6 ch)' } }),
    chartCaption: `Rows 1–4 across ${k} repeats. Each shell's five dc all go into one stitch; the sc between them sits on the centre of the shell below.`,
  };
}

/* ── V-stitch ─────────────────────────────────────────────────────── */

function vStitch(input: PlanInput): Plan {
  // Multiple of 3 + 4: (dc, ch 1, dc) in one stitch, a dc at each edge.
  const vs = Math.max(1, Math.round((input.stitchesPerCm * input.widthCm - 4) / 3));
  const foundation = 3 * vs + 4;
  const rows = Math.max(2, input.rows);

  const k = 4;
  const cols = 3 * k + 1;
  const b = new RowChartBuilder(cols);
  b.foundation(cols);
  const v = (c: number) => {
    b.stitch('dc', c, c - 0.55);
    b.chain(c, b.topOf(c) + HEIGHT.dc - 0.1);
    b.stitch('dc', c, c + 0.55);
  };
  for (let r = 1; r <= 4; r += 1) {
    b.beginRow(r);
    b.turningChain(3, true);
    if (r % 2 === 1) {
      for (let c = cols - 2; c >= 2; c -= 3) v(c);
      b.stitch('dc', 0);
    } else {
      for (let c = 2; c <= cols - 2; c += 3) v(c);
      b.stitch('dc', cols - 1);
    }
    b.endRow();
  }

  const across = 3 * vs + 2;
  return {
    stats: [
      { label: 'Foundation Chain', value: `ch ${foundation}` },
      { label: 'Total Rows', value: String(rows) },
      { label: 'V-sts per Row', value: String(vs) },
    ],
    foundation,
    stitchesAcross: across,
    rows,
    totalStitches: across * rows,
    finishedWidthCm: round1(across / input.stitchesPerCm),
    finishedHeightCm: input.heightCm,
    notes: ['V-st: (dc, ch 1, dc) in the same stitch or space.'],
    steps: [
      { heading: 'Foundation', text: `Ch ${foundation} (a multiple of 3, plus 4).` },
      {
        heading: 'Row 1',
        text: `V-st in 5th ch from hook (the first 3 skipped ch count as a dc), *sk 2 ch, V-st in next ch; rep from * across to the last 2 ch, sk 1 ch, dc in last ch, turn. (${vs} V-sts)`,
      },
      {
        heading: 'Row 2',
        text: `Ch 3 (counts as dc), V-st in the ch-1 sp of each V-st across, dc in top of tch, turn. (${vs} V-sts)`,
      },
      ...(rows > 2 ? [{ heading: range(3, rows), text: 'Rep Row 2.' }] : []),
      { heading: 'Finish', text: 'Fasten off and weave in the ends.' },
    ],
    abbreviations: [...abbreviations('ch', 'dc', 'sk', 'ch-sp', 'sp', 'tch', 'rep'), ['V-st', '(dc, ch 1, dc) in same st or sp']],
    chart: b.build(['ch', 'dc'], { repeat: { x1: 2, x2: 4, label: 'repeat (3 ch)' } }),
    chartCaption: `Rows 1–4 across ${k} V-stitches. From Row 2 on, each V goes into the ch-1 space at the centre of the V below.`,
  };
}

/* ── Tunisian simple stitch ───────────────────────────────────────── */

function tunisian(input: PlanInput): Plan {
  const n = Math.max(3, Math.round(input.stitchesPerCm * input.widthCm));
  const rows = Math.max(2, input.rows);

  const shown = 10;
  const b = new RowChartBuilder(shown);
  b.foundation(shown);
  for (let r = 1; r <= 4; r += 1) {
    // Tunisian is never turned: every forward pass runs right to left, every
    // return pass back, so every row starts — and is numbered — on the right.
    b.beginRow(r, false);
    b.labelAt(shown - 1, b.topOf(shown - 1) + 0.5);
    for (let c = shown - 1; c >= 0; c -= 1) b.stitch('tss', c);
    const top = b.level + 0.15;
    b.returnPass(0, shown - 1, top);
    for (let c = 0; c < shown; c += 1) b.space(c, top + 0.2);
    b.endRow();
  }

  return {
    stats: [
      { label: 'Foundation Chain', value: `ch ${n}` },
      { label: 'Total Rows', value: String(rows) },
      { label: 'Loops per Row', value: String(n) },
    ],
    foundation: n,
    stitchesAcross: n,
    rows,
    totalStitches: n * rows,
    finishedWidthCm: round1(n / input.stitchesPerCm),
    finishedHeightCm: input.heightCm,
    notes: [
      `Use a Tunisian (afghan) hook long enough to hold ${n} loops, or a cabled one. The work is never turned: the right side always faces you.`,
    ],
    steps: [
      { heading: 'Foundation', text: `Ch ${n}.` },
      {
        heading: 'Row 1, forward pass',
        text: `Insert hook in 2nd ch from hook, yo and pull up a loop; pull up a loop in each ch across, keeping every loop on the hook. (${n} loops)`,
      },
      {
        heading: 'Row 1, return pass',
        text: 'Yo and pull through 1 loop, *yo and pull through 2 loops; rep from * until 1 loop remains. Do not turn.',
      },
      {
        heading: 'Row 2, forward pass',
        text: `Sk the first vertical bar. *Insert hook under the next vertical bar, yo and pull up a loop; rep from * to the last bar, then insert hook under the last bar and the strand behind it, yo and pull up a loop. (${n} loops)`,
      },
      { heading: 'Row 2, return pass', text: 'As Row 1.' },
      ...(rows > 2 ? [{ heading: range(3, rows), text: 'Rep Row 2.' }] : []),
      { heading: 'Bind off', text: 'Sl st under each vertical bar across. Fasten off and weave in the ends.' },
    ],
    abbreviations: abbreviations('ch', 'Tss', 'sl st', 'yo', 'rep'),
    chart: b.build(['ch', 'tss', 'ret']),
    chartCaption: `Rows 1–4 across ${shown} stitches. The bars are the forward pass, picked up right to left; the wave along the top of each row is the return pass, worked back.`,
  };
}

/* ── Granny squares ───────────────────────────────────────────────── */

function granny(input: PlanInput): Plan {
  // A round adds a 3-dc group and a ch-1 to each side, about 4 stitches of
  // width, plus the corners: a k-round square is about 4k + 1 stitches across.
  // Aim for squares near 10cm, the size most blankets and bags are joined from.
  const rounds = Math.min(10, Math.max(2, Math.round((10 * input.stitchesPerCm - 1) / 4)));
  const sideCm = round1((4 * rounds + 1) / input.stitchesPerCm);
  const across = Math.max(1, Math.round(input.widthCm / sideCm));
  const down = Math.max(1, Math.round(input.heightCm / sideCm));
  const total = across * down;
  const dcPerSquare = 6 * rounds * (rounds + 1);

  const repeatRound =
    'Sl st in next 2 dc and in next ch-2 sp. Ch 3 (counts as dc), (2 dc, ch 2, 3 dc) in same sp, ' +
    '*[ch 1, 3 dc in next ch-1 sp] across to the next corner, ch 1, (3 dc, ch 2, 3 dc) in next ch-2 sp; ' +
    'rep from * 2 more times, [ch 1, 3 dc in next ch-1 sp] across, ch 1. Sl st in top of beg ch-3 to join.';

  const shownRounds = Math.min(rounds, 4);
  return {
    stats: [
      { label: 'Squares', value: `${across} × ${down}` },
      { label: 'Rounds each', value: String(rounds) },
      { label: 'Square size', value: `${sideCm} cm` },
    ],
    foundation: null,
    stitchesAcross: 4 * rounds + 1,
    rows: rounds,
    totalStitches: Math.round(dcPerSquare * total * 1.3),
    finishedWidthCm: round1(across * sideCm),
    finishedHeightCm: round1(down * sideCm),
    squares: { across, down, rounds, sideCm },
    notes: [
      `Make ${total} square${total === 1 ? '' : 's'} of ${rounds} rounds, then join them ${across} across by ${down} down. This uses ch-2 corners and ch-1 side spaces, the most common modern version; older patterns use ch-3 corners and ch-2 sides.`,
    ],
    steps: [
      { heading: 'Ring', text: 'Ch 4, sl st in first ch to form a ring (or start with a magic ring).' },
      {
        heading: 'Rnd 1',
        text: 'Ch 3 (counts as dc), 2 dc in ring, ch 2, *3 dc in ring, ch 2; rep from * 2 more times. Sl st in top of beg ch-3 to join. (12 dc, 4 ch-2 sps)',
      },
      {
        heading: 'Rnd 2',
        text: 'Sl st in next 2 dc and in next ch-2 sp. Ch 3 (counts as dc), (2 dc, ch 2, 3 dc) in same sp, *ch 1, (3 dc, ch 2, 3 dc) in next ch-2 sp; rep from * 2 more times, ch 1. Sl st in top of beg ch-3 to join. (24 dc)',
      },
      ...(rounds >= 3
        ? [
            {
              heading: 'Rnd 3',
              text: 'Sl st in next 2 dc and in next ch-2 sp. Ch 3 (counts as dc), (2 dc, ch 2, 3 dc) in same sp, *ch 1, 3 dc in next ch-1 sp, ch 1, (3 dc, ch 2, 3 dc) in next ch-2 sp; rep from * 2 more times, ch 1, 3 dc in next ch-1 sp, ch 1. Sl st in top of beg ch-3 to join. (36 dc)',
            },
          ]
        : []),
      ...(rounds >= 4
        ? [
            {
              heading: range(4, rounds, 'Rnd'),
              text: `${repeatRound} ${rounds > 4 ? `(12 more dc each round; ${12 * rounds} dc in Rnd ${rounds})` : '(48 dc)'}`,
            },
          ]
        : []),
      { heading: 'Finish each square', text: 'Fasten off and weave in the ends.' },
      {
        heading: 'Join',
        text: `Lay the squares out ${across} across and ${down} down. Join them with a whip stitch or sl st through the back loops, first in strips, then the strips together.`,
      },
    ],
    abbreviations: abbreviations('ch', 'sl st', 'dc', 'sp', 'ch-sp', 'beg', 'rnd', 'rep'),
    chart: grannyChart(shownRounds),
    chartCaption: `Rounds 1–${shownRounds} of one square, worked from the centre out, counter-clockwise.${rounds > shownRounds ? ` Rounds ${shownRounds + 1}–${rounds} repeat Round ${shownRounds}, with one more group on each side each time.` : ''}`,
  };
}

/** The plan for a stitch pattern, sized to the piece. */
export function planPattern(input: PlanInput): Plan {
  switch (input.stitch) {
    case 'hdc':
    case 'dc':
    case 'tr':
      return solid(input.stitch, input);
    case 'moss':
      return moss(input);
    case 'shell':
      return shell(input);
    case 'vstitch':
      return vStitch(input);
    case 'tunisian':
      return tunisian(input);
    case 'granny':
      return granny(input);
    default:
      return solid('sc', input);
  }
}
