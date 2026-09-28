import { CHART_COLOURS, chartSvg, keySvg } from './chart';
import type { Plan } from './stitchPatterns';

/*
 * The stitch diagram as a pattern prints it: a title, the chart, a key to the
 * symbols it uses, and a line on how to read it. One self-contained SVG, so
 * the page shows exactly the file it offers for download.
 */

const W = 640;
const { INK, BLUE, PAPER, MUTED, FONT } = CHART_COLOURS;

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Greedy word wrap, by a character budget — close enough for a caption. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > max) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function stitchDiagramSvg(plan: Plan, title: string): string {
  const inRounds = Boolean(plan.squares);
  const chartTop = 52;
  const chart = chartSvg(plan.chart, { left: 24, top: chartTop, width: W - 48, height: inRounds ? 440 : 320 });

  const keyTop = chartTop + chart.height + 20;
  const key = keySvg(plan.chart.kinds, 32, keyTop + 18);

  // How to read it, beside the key.
  const readingX = 300;
  const reading = [
    inRounds
      ? 'Start at the centre and work outward, counter-clockwise. Alternate rounds are printed in black and blue.'
      : plan.chart.kinds.includes('tss')
        ? 'Read from the bottom up. Each row is a forward pass, right to left, then a return pass back. The work is never turned.'
        : 'Read from the bottom up. Odd rows are worked right to left and even rows left to right, each starting where its number is. Alternate rows are printed in black and blue.',
    plan.chartCaption,
  ];
  const readingLines = reading.flatMap((p, i) => (i ? [''] : []).concat(wrap(p, 42)));
  const readingSvg = readingLines
    .map((line, i) => `<text x="${readingX}" y="${keyTop + 30 + i * 16}" font-size="12" fill="${INK}">${esc(line)}</text>`)
    .join('');

  const h = Math.max(keyTop + 18 + key.height, keyTop + 30 + readingLines.length * 16) + 24;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img" aria-label="${esc(`${title} stitch diagram`)}" font-family="${esc(FONT)}">` +
    `<rect width="100%" height="100%" fill="${PAPER}" />` +
    `<text x="24" y="30" font-size="11" font-weight="700" letter-spacing="1.6" fill="${MUTED}">${esc(`${title.toUpperCase()} · STITCH DIAGRAM`)}</text>` +
    `<g aria-hidden="true">${chart.svg}</g>` +
    `<line x1="24" y1="${keyTop}" x2="${W - 24}" y2="${keyTop}" stroke="#EBD9A0" />` +
    `<text x="32" y="${keyTop + 12}" font-size="10" font-weight="700" letter-spacing="1.4" fill="${MUTED}">KEY</text>` +
    key.svg +
    `<text x="${readingX}" y="${keyTop + 12}" font-size="10" font-weight="700" letter-spacing="1.4" fill="${MUTED}">READING THE CHART</text>` +
    readingSvg +
    // A swatch of the two row colours, so "black and blue" has something to point at.
    `<rect x="${W - 60}" y="${keyTop + 6}" width="10" height="10" rx="2" fill="${INK}" /><rect x="${W - 46}" y="${keyTop + 6}" width="10" height="10" rx="2" fill="${BLUE}" />` +
    `</svg>`
  );
}
