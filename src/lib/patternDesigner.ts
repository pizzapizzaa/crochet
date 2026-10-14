import { SYMBOL_NAMES, symbolSvg, type StitchKind } from './crochet/chart';

export type DesignerKind = StitchKind |
  'dtr' | 'sc2tog' | 'sc3tog' | 'hdc2tog' | 'dc2tog' | 'dc3tog' | 'tr2tog' |
  'hdc-inc' | 'dc-inc' | 'tr-inc' | 'dc3-cluster' | 'hdc3-cluster' | 'dc5-popcorn' |
  'dc5-shell' | 'ch3-picot' | 'fpdc' | 'bpdc' | 'blo' | 'flo' | 'chain3' | 'chain5' |
  'crossed-dc' | 'crossed-dc-chain' | 'magic-loop' | 'fan' | 'start' | 'end';
export type DesignerElementKind = DesignerKind | 'text';

export const DESIGN_KINDS: DesignerKind[] = [
  'ch', 'slst', 'sc', 'hdc', 'dc', 'tr', 'dtr', 'tss', 'ret',
  'sc2tog', 'sc3tog', 'hdc2tog', 'dc2tog', 'dc3tog', 'tr2tog',
  'hdc-inc', 'dc-inc', 'tr-inc', 'dc3-cluster', 'hdc3-cluster',
  'dc5-popcorn', 'dc5-shell', 'ch3-picot', 'fpdc', 'bpdc', 'blo', 'flo',
  'chain3', 'chain5', 'crossed-dc', 'crossed-dc-chain', 'magic-loop', 'fan', 'start', 'end',
];

export const DESIGN_NAMES: Record<DesignerKind, string> = {
  ...SYMBOL_NAMES,
  dtr: 'double treble crochet (dtr)',
  sc2tog: 'single crochet two together (sc2tog)',
  sc3tog: 'single crochet three together (sc3tog)',
  hdc2tog: 'half double crochet two together (hdc2tog)',
  dc2tog: 'double crochet two together (dc2tog)',
  dc3tog: 'double crochet three together (dc3tog)',
  tr2tog: 'treble crochet two together (tr2tog)',
  'hdc-inc': 'half double crochet increase (2 hdc)',
  'dc-inc': 'double crochet increase (2 dc)',
  'tr-inc': 'treble crochet increase (2 tr)',
  'dc3-cluster': '3 double crochet cluster',
  'hdc3-cluster': '3 half double crochet cluster',
  'dc5-popcorn': '5 double crochet popcorn',
  'dc5-shell': '5 double crochet shell',
  'ch3-picot': 'chain-3 picot',
  fpdc: 'front post double crochet (FPdc)',
  bpdc: 'back post double crochet (BPdc)',
  blo: 'back loop only (BLO)',
  flo: 'front loop only (FLO)',
  chain3: 'chain 3',
  chain5: 'chain 5',
  'crossed-dc': '2 crossed double crochet',
  'crossed-dc-chain': '2 crossed double crochet with chain',
  'magic-loop': 'magic loop',
  fan: 'fan',
  start: 'beginning of work',
  end: 'end / bind off',
};

export const DESIGN_SHORT_NAMES: Record<DesignerKind, string> = {
  ch: 'ch', slst: 'sl st', sc: 'sc', hdc: 'hdc', dc: 'dc', tr: 'tr', dtr: 'dtr', tss: 'Tss', ret: 'return',
  sc2tog: 'sc2tog', sc3tog: 'sc3tog', hdc2tog: 'hdc2tog', dc2tog: 'dc2tog', dc3tog: 'dc3tog', tr2tog: 'tr2tog',
  'hdc-inc': '2 hdc', 'dc-inc': '2 dc', 'tr-inc': '2 tr', 'dc3-cluster': '3 dc cl',
  'hdc3-cluster': '3 hdc cl', 'dc5-popcorn': 'popcorn', 'dc5-shell': 'shell', 'ch3-picot': 'picot',
  fpdc: 'FPdc', bpdc: 'BPdc', blo: 'BLO', flo: 'FLO', chain3: 'ch 3', chain5: 'ch 5',
  'crossed-dc': 'cross dc', 'crossed-dc-chain': 'cross ch', 'magic-loop': 'magic loop', fan: 'fan', start: 'start', end: 'end',
};

const BASE_KINDS: StitchKind[] = ['ch', 'slst', 'sc', 'hdc', 'dc', 'tr', 'tss', 'ret'];
export interface DesignerStitch {
  id: string;
  kind: DesignerElementKind;
  x: number;
  y: number;
  angle: number;
  size: number;
  colour: string;
  text?: string;
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
        !(stitch.kind === 'text' || DESIGN_KINDS.includes(stitch.kind as DesignerKind)) ||
        (stitch.kind === 'text' && (typeof stitch.text !== 'string' || stitch.text.length > 120)) ||
        !finite(stitch.x, -100000, 100000) || !finite(stitch.y, -100000, 100000) ||
        !finite(stitch.angle, -36000, 36000) || !finite(stitch.size, 4, 500) || !/^#[\da-f]{6}$/i.test(stitch.colour)) {
      throw new Error('Invalid stitch in pattern document.');
    }
    ids.add(stitch.id);
  }
  return {
    version: 1, title: doc.title.trim(), width: doc.width, height: doc.height,
    viewport: { x: doc.viewport.x, y: doc.viewport.y, zoom: doc.viewport.zoom },
    stitches: doc.stitches.map(({ id, kind, x, y, angle, size, colour, text }) => ({ id, kind, x, y, angle, size, colour, ...(kind === 'text' ? { text } : {}) })),
  };
}

export function stitchSvg(stitch: DesignerStitch): string {
  if (stitch.kind === 'text') {
    const escaped = (stitch.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<text x="0" y="0" font-family="system-ui, sans-serif" font-size="${stitch.size}" text-anchor="middle" dominant-baseline="middle" fill="${stitch.colour}">${escaped}</text>`;
  }
  if (stitch.kind === 'ret') return symbolSvg('ret', -20, 0, 20, 0, stitch.colour, 24);
  if (stitch.kind === 'ch' || stitch.kind === 'slst') return symbolSvg(stitch.kind, 0, 0, 0, 0, stitch.colour, 24);
  if (BASE_KINDS.includes(stitch.kind as StitchKind)) {
    return symbolSvg(stitch.kind as StitchKind, 0, 20, 0, -20, stitch.colour, 24);
  }

  const stroke = `stroke="${stitch.colour}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const path = (d: string) => `<path d="${d}" ${stroke} />`;
  const post = (kind: 'sc' | 'hdc' | 'dc' | 'tr', x1: number, x2: number, y1 = 20, y2 = -20) =>
    symbolSvg(kind, x1, y1, x2, y2, stitch.colour, 24);
  const increase = (kind: 'sc' | 'hdc' | 'dc' | 'tr', count: number) => Array.from({ length: count }, (_, index) => {
    const top = (index - (count - 1) / 2) * 9;
    return post(kind, 0, top);
  }).join('');
  const decrease = (kind: 'sc' | 'hdc' | 'dc' | 'tr', count: number) => Array.from({ length: count }, (_, index) => {
    const base = (index - (count - 1) / 2) * 12;
    return post(kind, base, 0);
  }).join('');
  const chain = (count: number) => Array.from({ length: count }, (_, index) => {
    const x = (index - (count - 1) / 2) * 9;
    return symbolSvg('ch', x, 0, x, 0, stitch.colour, 18);
  }).join('');
  const shell = (count = 5) => increase('dc', count);

  switch (stitch.kind) {
    case 'dtr': return post('tr', 0, 0) + path('M-4,-12L4,-15');
    case 'sc2tog': return decrease('sc', 2);
    case 'sc3tog': return decrease('sc', 3);
    case 'hdc2tog': return decrease('hdc', 2);
    case 'dc2tog': return decrease('dc', 2);
    case 'dc3tog': return decrease('dc', 3);
    case 'tr2tog': return decrease('tr', 2);
    case 'hdc-inc': return increase('hdc', 2);
    case 'dc-inc': return increase('dc', 2);
    case 'tr-inc': return increase('tr', 2);
    case 'dc3-cluster': return decrease('dc', 3) + path('M-5,-18Q0,-25 5,-18');
    case 'hdc3-cluster': return decrease('hdc', 3) + path('M-5,-18Q0,-25 5,-18');
    case 'dc5-popcorn': return shell() + `<ellipse cx="0" cy="-8" rx="6" ry="5" ${stroke} />`;
    case 'dc5-shell': return shell();
    case 'ch3-picot': return chain(3) + `<ellipse cx="0" cy="-14" rx="5" ry="4" ${stroke} />`;
    case 'fpdc': return post('dc', 0, 0) + path('M-8,10Q-13,0 -8,-10');
    case 'bpdc': return post('dc', 0, 0) + path('M8,10Q13,0 8,-10');
    case 'blo': return post('sc', 0, 0) + path('M-10,14Q0,7 10,14');
    case 'flo': return post('sc', 0, 0) + path('M-10,19Q0,26 10,19');
    case 'chain3': return chain(3);
    case 'chain5': return chain(5);
    case 'crossed-dc': return post('dc', -10, 9) + post('dc', 10, -9);
    case 'crossed-dc-chain': return post('dc', -10, 9) + post('dc', 10, -9) + chain(1);
    case 'magic-loop': return `<path d="M0,19C-22,15 -19,-15 2,-16C21,-17 20,10 2,10C-9,10 -10,-4 0,-5C7,-6 9,2 4,4" ${stroke} />`;
    case 'fan': return shell();
    case 'start': return `<path d="M0,-19L17,14H-17Z" ${stroke} />`;
    case 'end': return `<path d="M0,-19L17,14H-17Z" fill="${stitch.colour}" stroke="${stitch.colour}" stroke-width="2" />`;
    default: return '';
  }
}

export function patternSvg(document: PatternDocument, transparent = false): string {
  const doc = parsePattern(document);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${transparent ? '' : `<rect width="${doc.width}" height="${doc.height}" fill="#ffffff"/>`}${doc.stitches.map(stitch => `<g transform="translate(${stitch.x} ${stitch.y}) rotate(${stitch.angle})${stitch.kind === 'text' ? '' : ` scale(${stitch.size / 24})`}">${stitchSvg(stitch)}</g>`).join('')}</svg>`;
}

export function canvasPoint(screen: { x: number; y: number }, viewport: PatternDocument['viewport']) {
  return { x: (screen.x - viewport.x) / viewport.zoom, y: (screen.y - viewport.y) / viewport.zoom };
}

export function zoomAt(viewport: PatternDocument['viewport'], screen: { x: number; y: number }, zoom: number) {
  const point = canvasPoint(screen, viewport);
  const next = Math.max(0.1, Math.min(5, zoom));
  return { zoom: next, x: screen.x - point.x * next, y: screen.y - point.y * next };
}