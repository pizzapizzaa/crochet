/*
 * A to-scale schematic of the panel the pattern generator describes.
 *
 * Drawn in code rather than by an image model, on purpose: every number on it
 * is the pattern's own — the foundation chain, the row count, the gauge — so
 * it can be trusted in a way a generated picture cannot. It is the same flat,
 * turned-rows panel the written pattern works, drawn to the proportions of the
 * finished piece.
 *
 * Returned as a string of SVG so the page can show it and offer it as a file
 * with no second rendering path. Colours are the site's tokens written out as
 * hex, because a downloaded file has no stylesheet to resolve variables from.
 */

export interface SchematicInput {
  widthCm: number;
  heightCm: number;
  castOn: number;
  totalRows: number;
  /** The turning chain the pattern adds to the foundation. */
  turningChain: number;
  stitchesPer5cm: number;
  rowsPer5cm: number;
  stitchLabel: string;
  stitchAbbr: string;
  hookSize: string;
  yarnLabel: string;
  projectType: string;
}

const INK = '#003B33';
const BODY = '#005247';
const MUTED = '#2E6A60';
const FAINT = '#7FB3AA';
const ACCENT = '#00695C';
const PAPER = '#FFFDF2';
const PANEL = '#FBF1CA';
const PANEL_EDGE = '#DCC784';
const LEMON = '#FFEB6C';
const FONT = "'Nunito Sans', ui-sans-serif, system-ui, sans-serif";

const VIEW_W = 640;
const PANEL_X = 84;
const PANEL_Y = 72;
const MAX_PANEL_W = 430;
const MAX_PANEL_H = 360;

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** A round step that labels a count in at most `maxLabels` places. */
export function niceStep(count: number, maxLabels: number): number {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) {
    if (count / step <= maxLabels) return step;
  }
  return Math.ceil(count / maxLabels);
}

function text(x: number, y: number, body: string, attrs = ''): string {
  return `<text x="${fmt(x)}" y="${fmt(y)}" ${attrs}>${esc(body)}</text>`;
}

/** A dimension line with end stops and a label, horizontal or vertical. */
function dimension(x1: number, y1: number, x2: number, y2: number, label: string): string {
  const vertical = x1 === x2;
  const stop = (x: number, y: number) =>
    vertical
      ? `<line x1="${fmt(x - 5)}" y1="${fmt(y)}" x2="${fmt(x + 5)}" y2="${fmt(y)}" />`
      : `<line x1="${fmt(x)}" y1="${fmt(y - 5)}" x2="${fmt(x)}" y2="${fmt(y + 5)}" />`;
  const labelSvg = vertical
    ? text(x1 + 12, (y1 + y2) / 2, label, `font-size="13" font-weight="700" fill="${INK}" dominant-baseline="middle"`)
    : text((x1 + x2) / 2, y1 - 8, label, `font-size="13" font-weight="700" fill="${INK}" text-anchor="middle"`);
  return (
    `<g stroke="${MUTED}" stroke-width="1.2">` +
    `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" />${stop(x1, y1)}${stop(x2, y2)}</g>` +
    labelSvg
  );
}

export function schematicSvg(input: SchematicInput): string {
  const width = Math.max(input.widthCm, 1);
  const height = Math.max(input.heightCm, 1);
  const rows = Math.max(input.totalRows, 1);
  const stitches = Math.max(input.castOn, 1);

  // One scale for both axes, so the drawing has the finished piece's shape.
  const scale = Math.min(MAX_PANEL_W / width, MAX_PANEL_H / height);
  const panelW = width * scale;
  const panelH = height * scale;
  const left = PANEL_X + (MAX_PANEL_W - panelW) / 2;
  const top = PANEL_Y;
  const bottom = top + panelH;
  const right = left + panelW;
  const rowPx = panelH / rows;

  const parts: string[] = [];

  /* The panel, and its rows. Every row is drawn when they are far enough
   * apart to read; otherwise every labelled row, so the texture still says
   * "worked in rows" without turning into a solid block. */
  parts.push(
    `<rect x="${fmt(left)}" y="${fmt(top)}" width="${fmt(panelW)}" height="${fmt(panelH)}" rx="6" fill="${PANEL}" stroke="${PANEL_EDGE}" stroke-width="1.5" />`,
  );
  const rowStep = niceStep(rows, 10);
  const lineEvery = rowPx >= 4 ? 1 : rowStep;
  const rowLines: string[] = [];
  for (let r = lineEvery; r < rows; r += lineEvery) {
    const y = bottom - r * rowPx;
    const major = r % rowStep === 0;
    rowLines.push(
      `<line x1="${fmt(left + 1)}" y1="${fmt(y)}" x2="${fmt(right - 1)}" y2="${fmt(y)}" stroke="${major ? PANEL_EDGE : '#EBD9A0'}" stroke-width="${major ? 1 : 0.6}" />`,
    );
  }
  parts.push(`<g>${rowLines.join('')}</g>`);

  /* Row numbers up the left side, counted from the foundation. */
  const rowLabels: string[] = [];
  for (let r = rowStep; r <= rows; r += rowStep) {
    const y = bottom - r * rowPx + rowPx / 2;
    rowLabels.push(
      `<line x1="${fmt(left - 6)}" y1="${fmt(y)}" x2="${fmt(left)}" y2="${fmt(y)}" stroke="${FAINT}" />` +
        text(left - 10, y, String(r), `font-size="11" fill="${MUTED}" text-anchor="end" dominant-baseline="middle"`),
    );
  }
  parts.push(`<g>${rowLabels.join('')}</g>`);
  parts.push(
    text(left - 44, top + panelH / 2, 'ROWS', `font-size="10" font-weight="700" letter-spacing="1.5" fill="${FAINT}" text-anchor="middle" transform="rotate(-90 ${fmt(left - 44)} ${fmt(top + panelH / 2)})"`),
  );

  /* The first two rows, and which way each one travels. Row 1 is worked
   * right to left along the foundation, and each row after turns back. */
  if (rowPx >= 3) {
    const arrow = (y: number, towardsLeft: boolean, label: string) => {
      const x1 = towardsLeft ? right - 14 : left + 14;
      const x2 = towardsLeft ? left + 14 : right - 14;
      const head = towardsLeft ? `${fmt(x2 + 7)},${fmt(y - 4)} ${fmt(x2)},${fmt(y)} ${fmt(x2 + 7)},${fmt(y + 4)}` : `${fmt(x2 - 7)},${fmt(y - 4)} ${fmt(x2)},${fmt(y)} ${fmt(x2 - 7)},${fmt(y + 4)}`;
      return (
        `<line x1="${fmt(x1)}" y1="${fmt(y)}" x2="${fmt(x2)}" y2="${fmt(y)}" stroke="${ACCENT}" stroke-width="1.6" stroke-dasharray="5 4" />` +
        `<polyline points="${head}" fill="none" stroke="${ACCENT}" stroke-width="1.6" />` +
        text(towardsLeft ? right + 8 : right + 8, y, label, `font-size="11" fill="${ACCENT}" font-weight="700" dominant-baseline="middle"`)
      );
    };
    const r1 = bottom - Math.max(rowPx, 9) * 0.5;
    const r2 = bottom - Math.max(rowPx, 9) * 1.5 - 4;
    if (r2 > top + 8) parts.push(arrow(r1, true, 'Row 1'), arrow(r2, false, 'Row 2'));
  }

  /* The foundation chain along the bottom edge. */
  const chainStep = niceStep(stitches, 8);
  const chainTicks: string[] = [];
  for (let s = 0; s <= stitches; s += chainStep) {
    const x = right - (s / stitches) * panelW;
    chainTicks.push(`<line x1="${fmt(x)}" y1="${fmt(bottom)}" x2="${fmt(x)}" y2="${fmt(bottom + 6)}" stroke="${FAINT}" />`);
  }
  parts.push(`<g>${chainTicks.join('')}</g>`);
  parts.push(`<line x1="${fmt(left)}" y1="${fmt(bottom)}" x2="${fmt(right)}" y2="${fmt(bottom)}" stroke="${LEMON}" stroke-width="4" stroke-linecap="round" />`);
  parts.push(
    text(
      (left + right) / 2,
      bottom + 22,
      `Foundation: ch ${input.castOn + input.turningChain} · ${input.castOn} ${input.stitchAbbr} per row`,
      `font-size="12" fill="${BODY}" text-anchor="middle"`,
    ),
  );

  /* Finished size. */
  parts.push(dimension(left, top - 22, right, top - 22, `${fmt(input.widthCm)} cm`));
  parts.push(dimension(right + 56, top, right + 56, bottom, `${fmt(input.heightCm)} cm`));
  parts.push(
    text(right + 68, (top + bottom) / 2 + 18, `${input.totalRows} rows`, `font-size="11" fill="${MUTED}" dominant-baseline="middle"`),
  );

  /* The gauge square at the drawing's own scale, so the swatch you make can
   * be laid against it. Too small to see on a big piece, so then it is drawn
   * at a readable size and says so. */
  const legendTop = bottom + 52;
  const swatchTrue = 5 * scale;
  const toScale = swatchTrue >= 14;
  const swatch = toScale ? Math.min(swatchTrue, 96) : 44;
  const sx = PANEL_X;
  parts.push(
    `<rect x="${fmt(sx)}" y="${fmt(legendTop)}" width="${fmt(swatch)}" height="${fmt(swatch)}" rx="3" fill="${PANEL}" stroke="${ACCENT}" stroke-width="1.2" stroke-dasharray="${toScale && swatchTrue <= 96 ? '0' : '4 3'}" />`,
  );
  // Two short lines, so the caption stays inside the swatch's own column.
  const captionY = legendTop + swatch + 15;
  parts.push(text(sx, captionY, '5 cm gauge square', `font-size="10" fill="${MUTED}"`));
  parts.push(text(sx, captionY + 13, toScale && swatchTrue <= 96 ? 'to scale' : 'not to scale', `font-size="10" fill="${FAINT}"`));

  const legendX = sx + Math.max(swatch, 110) + 28;
  const legend: [string, string][] = [
    ['Stitch', input.stitchLabel],
    ['Gauge', `${fmt(input.stitchesPer5cm)} sts × ${fmt(input.rowsPer5cm)} rows per 5 cm`],
    ['Hook', input.hookSize],
    ['Yarn', input.yarnLabel],
    ['Work', 'In rows, turning at the end of each'],
  ];
  legend.forEach(([label, value], i) => {
    const y = legendTop + 10 + i * 20;
    parts.push(text(legendX, y, label.toUpperCase(), `font-size="10" font-weight="700" letter-spacing="1.2" fill="${FAINT}"`));
    // What fits between the legend column and the edge, allowing for a
    // wide fallback font when the file is opened somewhere without Nunito.
    const fitted = value.length > 44 ? `${value.slice(0, 43)}…` : value;
    parts.push(text(legendX + 58, y, fitted, `font-size="12" fill="${BODY}"`));
  });

  const viewH = Math.max(captionY + 24, legendTop + legend.length * 20 + 20);
  const title = `${input.projectType} schematic`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${fmt(viewH)}" width="${VIEW_W}" height="${fmt(viewH)}" role="img" aria-label="${esc(`${title}: ${fmt(input.widthCm)} by ${fmt(input.heightCm)} cm, ${input.castOn} stitches by ${input.totalRows} rows`)}" font-family="${esc(FONT)}">` +
    `<rect width="100%" height="100%" fill="${PAPER}" />` +
    text(24, 30, title.toUpperCase(), `font-size="11" font-weight="700" letter-spacing="1.6" fill="${ACCENT}"`) +
    parts.join('') +
    `</svg>`
  );
}
