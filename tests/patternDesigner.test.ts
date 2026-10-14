import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { canvasPoint, DESIGN_KINDS, DESIGN_NAMES, emptyPattern, parsePattern, patternSvg, stitchSvg, zoomAt } from '../src/lib/patternDesigner';
import { DELETE, GET, PUT } from '../src/pages/api/pos/pattern-designs/[...id]';

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), admin: vi.fn(),
  query: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() },
}));
vi.mock('../src/lib/auth', () => ({ guardApi: mocks.guard, isAuthed: vi.fn() }));
vi.mock('../src/lib/supabaseAdmin', () => ({ getSupabaseAdmin: mocks.admin }));

describe('pattern designer document', () => {
  it('keeps the point under the cursor fixed when zooming', () => {
    const viewport = { x: 40, y: -20, zoom: 0.5 };
    const cursor = { x: 200, y: 150 };
    expect(canvasPoint(cursor, zoomAt(viewport, cursor, 2))).toEqual(canvasPoint(cursor, viewport));
    expect(zoomAt(viewport, cursor, 20).zoom).toBe(5);
  });

  it('round trips editable positions, rotations and viewport', () => {
    const doc = emptyPattern();
    doc.stitches.push({ id: 'one', kind: 'dc', x: 123.5, y: 201, angle: 37.8, size: 30, colour: '#123456' });
    expect(parsePattern(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('includes the reference stitch and instruction symbols in the palette', () => {
    for (const kind of ['dtr', 'sc2tog', 'dc3tog', 'dc-inc', 'dc3-cluster', 'dc5-popcorn', 'dc5-shell', 'ch3-picot', 'fpdc', 'bpdc', 'blo', 'flo', 'crossed-dc', 'magic-loop', 'start', 'end'] as const) {
      expect(DESIGN_KINDS).toContain(kind);
      expect(DESIGN_NAMES[kind]).toBeTruthy();
      expect(stitchSvg({ id: kind, kind, x: 0, y: 0, angle: 0, size: 24, colour: '#123456' })).toContain('#123456');
    }
  });

  it('adds editable system-font text and escapes it in SVG exports', () => {
    const doc = emptyPattern();
    doc.stitches.push({ id: 'text-1', kind: 'text', text: '<Hook & yarn>', x: 40, y: 50, angle: 0, size: 32, colour: '#123456' });

    const parsed = parsePattern(JSON.parse(JSON.stringify(doc)));
    expect(parsed.stitches[0].text).toBe('<Hook & yarn>');
    const svg = patternSvg(parsed);
    expect(svg).toContain('font-family="system-ui, sans-serif"');
    expect(svg).toContain('&lt;Hook &amp; yarn&gt;');
    expect(svg).toContain('font-size="32"');
  });

  it('exports artwork bounds and transforms, never viewport or controls', () => {
    const doc = emptyPattern();
    doc.stitches.push({ id: 'one', kind: 'sc', x: 123, y: 201, angle: 38, size: 24, colour: '#123456' });
    const svg = patternSvg(doc);
    expect(svg).toContain('viewBox="0 0 1000 800"');
    expect(svg).toContain('translate(123 201) rotate(38) scale(1)');
    expect(svg).toContain('fill="#ffffff"');
    doc.viewport = { x: -900, y: 200, zoom: 4 };
    expect(patternSvg(doc)).toBe(svg);
    expect(patternSvg(doc, true)).not.toContain('<rect');
  });

  it('rejects unsafe or malformed documents', () => {
    expect(() => parsePattern({ ...emptyPattern(), width: Infinity })).toThrow();
    const stitch = { id: 'one', kind: 'dc', x: 0, y: 0, angle: 0, size: 24, colour: '#123456' };
    expect(() => parsePattern({ ...emptyPattern(), stitches: [stitch, stitch] })).toThrow();
    expect(() => parsePattern({ ...emptyPattern(), stitches: [{ ...stitch, colour: 'red" onload="alert(1)' }] })).toThrow();
  });

  it('centres chains and draws return passes with a nonzero horizontal span', () => {
    const stitch = { id: 'one', kind: 'ch' as const, x: 0, y: 0, angle: 0, size: 24, colour: '#123456' };
    expect(stitchSvg(stitch)).toContain('cy="0"');
    expect(stitchSvg({ ...stitch, kind: 'ret' })).toContain('M-20,0C');
    expect(stitchSvg({ ...stitch, kind: 'ret' })).toContain('20,0');
  });
});

describe('pattern designer API', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const context = (method: string, body?: unknown, origin = 'http://localhost', revision = 1) => {
    const url = new URL(`http://localhost/api/pos/pattern-designs/${id}?revision=${revision}`);
    return { params: { id }, cookies: {}, url, request: new Request(url, {
      method, headers: { 'Content-Type': 'application/json', Origin: origin },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) } as unknown as APIContext;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockReturnValue(null);
    mocks.admin.mockReturnValue({ from: vi.fn(() => mocks.query) });
    for (const key of ['select', 'insert', 'update', 'delete', 'eq', 'order'] as const) mocks.query[key].mockReturnValue(mocks.query);
    mocks.query.single.mockResolvedValue({ data: { id, revision: 1 }, error: null });
    mocks.query.maybeSingle.mockResolvedValue({ data: { id, revision: 2 }, error: null });
    mocks.query.limit.mockResolvedValue({ data: [], error: null });
  });

  it('rejects unauthenticated reads, saves and deletes before accessing the database', async () => {
    mocks.guard.mockReturnValue(new Response('Unauthorized', { status: 401 }));
    expect((await GET(context('GET'))).status).toBe(401);
    expect((await PUT(context('PUT', { document: emptyPattern(), revision: 0 }))).status).toBe(401);
    expect((await DELETE(context('DELETE'))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('rejects cross-origin writes and malformed documents', async () => {
    expect((await PUT(context('PUT', { document: emptyPattern(), revision: 0 }, 'https://other.example'))).status).toBe(403);
    expect((await DELETE(context('DELETE', undefined, 'https://other.example'))).status).toBe(403);
    expect((await PUT(context('PUT', { document: { ...emptyPattern(), stitches: [{ kind: 'invalid' }] }, revision: 0 }))).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it('creates once and checks the revision atomically on later saves', async () => {
    expect((await PUT(context('PUT', { document: emptyPattern(), revision: 0 }))).status).toBe(201);
    expect(mocks.query.insert).toHaveBeenCalledWith(expect.objectContaining({ id, revision: 1 }));
    expect((await PUT(context('PUT', { document: emptyPattern(), revision: 1 }))).status).toBe(200);
    expect(mocks.query.eq).toHaveBeenCalledWith('revision', 1);
    expect(mocks.query.update).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
  });

  it('does not overwrite conflicting or deleted patterns', async () => {
    mocks.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await PUT(context('PUT', { document: emptyPattern(), revision: 1 }))).status).toBe(409);
    mocks.query.single.mockResolvedValue({ data: null, error: { code: '23505' } });
    expect((await PUT(context('PUT', { document: emptyPattern(), revision: 0 }))).status).toBe(409);
  });

  it('reports missing storage instead of claiming a successful save', async () => {
    mocks.admin.mockReturnValue(null);
    const response = await PUT(context('PUT', { document: emptyPattern(), revision: 0 }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('local draft');
  });
});