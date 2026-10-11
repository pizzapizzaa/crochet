import { symbolSvg, type StitchKind } from './crochet/chart';

export const DESIGN_KINDS: StitchKind[] = ['ch', 'slst', 'sc', 'hdc', 'dc', 'tr', 'tss', 'ret'];
export interface DesignerStitch {
  id: string;
  kind: StitchKind;
  x: number;
  y: number;
  angle: number;
  size: number;
  colour: string;
}
export interface PatternDocument {
  version: 1;
  title: string;
  width: number;
  height: number;
  stitches: DesignerStitch[];
  viewport: { x: number; y: number; zoom: number };
}

export function emptyPattern(): PatternDocument {
  return { version: 1, title: 'Untitled pattern', width: 1000, height: 800, stitches: [], viewport: { x: 40, y: 40, zoom: 0.8 } };
}

export function parsePattern(value: unknown): PatternDocument {
  if (!value || typeof value !== 'object') throw new Error('Invalid pattern document.');
  const doc = value as PatternDocument;
  const finite = (number: unknown, min: number, max: number) => typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max;
  if (doc.version !== 1 || typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > 160 ||
      !finite(doc.width, 100, 10000) || !finite(doc.height, 100, 10000) ||
      !Array.isArray(doc.stitches) || doc.stitches.length > 10000 ||
      !doc.viewport || !finite(doc.viewport.zoom, 0.1, 5) || !finite(doc.viewport.x, -100000, 100000) || !finite(doc.viewport.y, -100000, 100000)) {
    throw new Error('Invalid pattern dimensions, title, or viewport.');
  }
  const ids = new Set<string>();
  for (const stitch of doc.stitches) {
    if (!stitch || typeof stitch.id !== 'string' || stitch.id.length > 80 || !stitch.id || ids.has(stitch.id) ||
        !DESIGN_KINDS.includes(stitch.kind) || !finite(stitch.x, -100000, 100000) || !finite(stitch.y, -100000, 100000) ||
        !finite(stitch.angle, -36000, 36000) || !finite(stitch.size, 4, 500) || !/^#[\da-f]{6}$/i.test(stitch.colour)) {
      throw new Error('Invalid stitch in pattern document.');
    }
    ids.add(stitch.id);
  }
  return {
    version: 1, title: doc.title.trim(), width: doc.width, height: doc.height,
    viewport: { x: doc.viewport.x, y: doc.viewport.y, zoom: doc.viewport.zoom },
    stitches: doc.stitches.map(({ id, kind, x, y, angle, size, colour }) => ({ id, kind, x, y, angle, size, colour })),
  };
}

export function stitchSvg(stitch: DesignerStitch): string {
  if (stitch.kind === 'ret') return symbolSvg('ret', -20, 0, 20, 0, stitch.colour, 24);
  if (stitch.kind === 'ch' || stitch.kind === 'slst') return symbolSvg(stitch.kind, 0, 0, 0, 0, stitch.colour, 24);
  const height = ({ hdc: 2, dc: 3, tr: 4 } as Partial<Record<StitchKind, number>>)[stitch.kind] ?? 1;
  return symbolSvg(stitch.kind, 0, height * 10, 0, -height * 10, stitch.colour, 24);
}

export function patternSvg(document: PatternDocument, transparent = false): string {
  const doc = parsePattern(document);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${transparent ? '' : `<rect width="${doc.width}" height="${doc.height}" fill="#ffffff"/>`}${doc.stitches.map(stitch => `<g transform="translate(${stitch.x} ${stitch.y}) rotate(${stitch.angle}) scale(${stitch.size / 24})">${stitchSvg(stitch)}</g>`).join('')}</svg>`;
}

export function canvasPoint(screen: { x: number; y: number }, viewport: PatternDocument['viewport']) {
  return { x: (screen.x - viewport.x) / viewport.zoom, y: (screen.y - viewport.y) / viewport.zoom };
}

export function zoomAt(viewport: PatternDocument['viewport'], screen: { x: number; y: number }, zoom: number) {
  const point = canvasPoint(screen, viewport);
  const next = Math.max(0.1, Math.min(5, zoom));
  return { zoom: next, x: screen.x - point.x * next, y: screen.y - point.y * next };
}