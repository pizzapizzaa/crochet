import type { Chart, Mark, RowLabel } from './chart';

/*
 * The classic granny square, charted in rounds from the centre out.
 *
 * Each round is four sides. On every side the round's 3-dc groups stand on
 * the round below — the two at the ends worked into the corner ch-2 spaces,
 * the ones between into the side ch-1 spaces — so round n has n groups a
 * side, n − 1 ch-1 spaces between them, and a ch-2 at each corner.
 *
 * Geometry: a side's groups sit one pitch apart, and a round is one dc tall.
 * A square only stays square if each round adds as much to the half-width
 * (one dc) as it does to half of each side (half a pitch), so the pitch is
 * two dc heights — which is also about right in yarn: three dc and a chain
 * are roughly twice as wide as a dc is tall.
 */

const DC = 2; // a dc, in chain units
const PITCH = DC * 2;
const SPREAD = 0.8; // between the tops of a group's three posts
const RING = 0.9;
/** Daylight between one round's tops and the next round's bases. */
const GAP = 0.35;

interface Point {
  x: number;
  y: number;
}

/** A side's local coordinates (s along it, d outward from the centre) in chart space. */
function place(side: number, s: number, d: number): Point {
  const theta = (side * Math.PI) / 2;
  return {
    x: d * Math.cos(theta) - s * Math.sin(theta),
    y: d * Math.sin(theta) + s * Math.cos(theta),
  };
}

/** SVG rotation that lays a chain along the direction from a to b (chart y is up, SVG y is down). */
const along = (a: Point, b: Point) => (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

export function grannyChart(rounds: number): Chart {
  const marks: Mark[] = [];
  const labels: RowLabel[] = [];

  const chain = (p: Point, row: number, angle: number) =>
    marks.push({ kind: 'ch', row, x1: p.x, y1: p.y, x2: p.x, y2: p.y, orient: 'along', angle });
  const post = (base: Point, top: Point, row: number) =>
    marks.push({ kind: 'dc', row, x1: base.x, y1: base.y, x2: top.x, y2: top.y });

  // The ring: ch 4, joined with a slip stitch.
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = { x: RING * Math.cos(a), y: RING * Math.sin(a) };
    chain(p, 0, (-a * 180) / Math.PI - 90);
  }
  marks.push({ kind: 'slst', row: 0, x1: RING, y1: 0, x2: RING, y2: 0 });

  // Where each round left its corner spaces and side spaces, per side.
  let corners: Point[] = [];
  let spaces: Point[][] = [[], [], [], []];
  let depth = RING;

  for (let n = 1; n <= rounds; n += 1) {
    const top = depth + DC;
    const half = ((n - 1) / 2) * PITCH + SPREAD;
    // Round 1 starts in the ring. Every round after slip-stitches across into
    // the next corner and starts there, so its ch-3 is the first post of the
    // group at the far end of side 0 — the first thing worked into that corner.
    const startJ = n === 1 ? 0 : n - 1;
    const startS = (startJ - (n - 1) / 2) * PITCH;
    const nextCorners: Point[] = [];
    const nextSpaces: Point[][] = [[], [], [], []];

    for (let side = 0; side < 4; side += 1) {
      for (let j = 0; j < n; j += 1) {
        const s = (j - (n - 1) / 2) * PITCH;
        // Round 1 stands in the ring; after that, end groups stand in the
        // corners and middle groups in the side spaces of the round below.
        const base =
          n === 1
            ? place(side, 0, RING)
            : j === 0
              ? corners[(side + 3) % 4]
              : j === n - 1
                ? corners[side]
                : spaces[side][j - 1];

        for (let k = -1; k <= 1; k += 1) {
          const tip = place(side, s + k * SPREAD, top);
          // The round's first dc is its starting ch-3, standing up the same way.
          if (side === 0 && j === startJ && k === -1) {
            for (let c = 0; c < 3; c += 1) {
              const t = (c + 0.5) / 3;
              chain({ x: base.x + (tip.x - base.x) * t, y: base.y + (tip.y - base.y) * t }, n, along(base, tip));
            }
          } else {
            post(base, tip, n);
          }
        }

        // A ch-1 between this group and the next along the side.
        if (j < n - 1) {
          const sp = place(side, s + PITCH / 2, top);
          chain(sp, n, along(place(side, 0, top), place(side, 1, top)));
          nextSpaces[side].push(sp);
        }
      }

      // The corner ch-2, turning from this side onto the next.
      const a = place(side, half + 0.55, top + 0.1);
      const b = place((side + 1) % 4, -(half + 0.55), top + 0.1);
      chain(a, n, along(place(side, 0, top), place(side, 1, top)));
      chain(b, n, along(place((side + 1) % 4, 0, top), place((side + 1) % 4, 1, top)));
      nextCorners[side] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    // Join with a slip stitch in the top of the beginning ch-3.
    const joinAt = place(0, startS - SPREAD - 0.35, top + 0.1);
    marks.push({ kind: 'slst', row: n, x1: joinAt.x, y1: joinAt.y, x2: joinAt.x, y2: joinAt.y });

    // Beside the round's first stitch, where charts put round numbers.
    const labelAt = place(0, startS - SPREAD - 0.6, depth + DC * 0.45);
    labels.push({ text: String(n), x: labelAt.x, y: labelAt.y, anchor: 'end', row: n });

    corners = nextCorners;
    spaces = nextSpaces;
    depth = top + GAP;
  }

  return {
    marks,
    labels,
    // From outside the bottom-right corner in to the ring, the way printed charts point.
    start: { x: RING * 0.7, y: -RING * 0.7, fromX: depth + 1.2, fromY: -(depth + 1.6), label: 'Start here' },
    kinds: ['ch', 'slst', 'dc'],
  };
}
