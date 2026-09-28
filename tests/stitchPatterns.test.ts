import { describe, expect, it } from 'vitest';
import { planPattern } from '../src/lib/crochet/stitchPatterns';
import { stitchDiagramSvg } from '../src/lib/crochet/sheet';

// Worsted-ish: 8 sts and 10 rows per 5cm, a 30cm square.
const base = { stitchesPerCm: 1.6, rows: 60, widthCm: 30, heightCm: 30 };

const text = (stitch: string) =>
  planPattern({ ...base, stitch })
    .steps.map((s) => `${s.heading}: ${s.text}`)
    .join('\n');

const count = (svg: string, needle: RegExp) => (svg.match(needle) ?? []).length;

describe('solid fabric', () => {
  it('counts the turning chain for dc and tr, not for sc and hdc', () => {
    expect(text('sc')).toContain('Ch 1 (does not count as a st)');
    expect(text('hdc')).toContain('Ch 2 (does not count as a st)');
    expect(text('dc')).toContain('Ch 3 (counts as dc)');
    expect(text('tr')).toContain('Ch 4 (counts as tr)');
  });

  it('chains enough for the stitches and the ones skipped at the start', () => {
    // 48 stitches: sc skips 1 ch, hdc 2 that do not count, dc 3 that count as one.
    expect(planPattern({ ...base, stitch: 'sc' }).foundation).toBe(49);
    expect(planPattern({ ...base, stitch: 'hdc' }).foundation).toBe(50);
    expect(planPattern({ ...base, stitch: 'dc' }).foundation).toBe(50);
    expect(planPattern({ ...base, stitch: 'tr' }).foundation).toBe(51);
    expect(text('dc')).toContain('Dc in 4th ch from hook');
  });

  it('never writes the old "SHELL in each SHELL" instructions', () => {
    for (const stitch of ['sc', 'hdc', 'dc', 'tr', 'moss', 'shell', 'vstitch', 'tunisian', 'granny']) {
      expect(text(stitch)).not.toMatch(/\b(SHELL|MOSS|VSTITCH|GRANNY) in each\b/);
    }
  });
});

describe('stitch multiples', () => {
  it('rounds shell to a multiple of 6 plus 2', () => {
    const plan = planPattern({ ...base, stitch: 'shell' });
    expect((plan.foundation! - 2) % 6).toBe(0);
    expect(text('shell')).toContain('5 dc in next ch');
    expect(text('shell')).toContain('3 dc in last sc');
  });

  it('rounds V-stitch to a multiple of 3 plus 4', () => {
    const plan = planPattern({ ...base, stitch: 'vstitch' });
    expect((plan.foundation! - 4) % 3).toBe(0);
  });

  it('gives moss an even foundation', () => {
    expect(planPattern({ ...base, stitch: 'moss' }).foundation! % 2).toBe(0);
  });

  it('reports the width the rounding actually gives', () => {
    const plan = planPattern({ ...base, stitch: 'shell' });
    // 8 shells: 6 × 8 + 1 = 49 stitches at 1.6 per cm.
    expect(plan.finishedWidthCm).toBeCloseTo(49 / 1.6, 1);
  });
});

describe('granny squares', () => {
  it('sizes squares from the gauge and lays them out to fill the piece', () => {
    const plan = planPattern({ ...base, stitch: 'granny', widthCm: 100, heightCm: 130 });
    expect(plan.squares).toBeDefined();
    const { across, down, sideCm, rounds } = plan.squares!;
    expect(rounds).toBe(4);
    expect(sideCm).toBeGreaterThan(8);
    expect(sideCm).toBeLessThan(13);
    expect(across * sideCm).toBeCloseTo(100, -1);
    expect(down * sideCm).toBeCloseTo(130, -1);
    expect(text('granny')).toContain('(3 dc, ch 2, 3 dc) in next ch-2 sp');
  });
});

describe('charts', () => {
  it('draws a shell as five dc out of one stitch', () => {
    const plan = planPattern({ ...base, stitch: 'shell' });
    const row1Dc = plan.chart.marks.filter((m) => m.row === 1 && m.kind === 'dc');
    // Three repeats shown, five dc each, every one based on its shell's stitch.
    expect(row1Dc).toHaveLength(15);
    expect(new Set(row1Dc.map((m) => m.x1)).size).toBe(3);
  });

  it('numbers odd rows on the right and even rows on the left', () => {
    const plan = planPattern({ ...base, stitch: 'dc' });
    const r1 = plan.chart.labels.find((l) => l.text === '1')!;
    const r2 = plan.chart.labels.find((l) => l.text === '2')!;
    expect(r1.x).toBeGreaterThan(r2.x);
  });

  it('draws every round of a granny square with 3-dc groups', () => {
    const plan = planPattern({ ...base, stitch: 'granny' });
    // Round n has 4n groups of 3, one post of the first replaced by its ch-3.
    for (let n = 1; n <= 4; n += 1) {
      const dc = plan.chart.marks.filter((m) => m.row === n && m.kind === 'dc');
      expect(dc).toHaveLength(12 * n - 1);
    }
  });

  it('renders a diagram sheet with a key for the symbols it uses', () => {
    const svg = stitchDiagramSvg(planPattern({ ...base, stitch: 'vstitch' }), 'V-Stitch');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('= double crochet (dc)');
    expect(svg).toContain('= chain (ch)');
    expect(count(svg, /<ellipse/g)).toBeGreaterThan(10);
  });
});
