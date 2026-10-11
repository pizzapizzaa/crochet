import { useEffect, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import { Copy, Download, FilePlus2, FolderOpen, Hand, MousePointer2, Redo2, Save, Trash2, Undo2, Upload, ZoomIn, ZoomOut, Maximize, ArrowUp, ArrowDown } from 'lucide-react';
import { SYMBOL_NAMES } from '../../lib/crochet/chart';
import { canvasPoint, DESIGN_KINDS, emptyPattern, parsePattern, patternSvg, stitchSvg, zoomAt, type DesignerStitch, type PatternDocument } from '../../lib/patternDesigner';
import './PatternDesigner.css';

type DesignSummary = { id: string; title: string; revision: number; updated_at: string; local?: boolean };
type StoredDesign = DesignSummary & { document: PatternDocument };
type Draft = { id: string; document: PatternDocument; revision: number; dirty: boolean; time: string };
const API = '/api/pos/pattern-designs';
const DRAFT_PREFIX = 'zippyzack-pattern:';
const LAST_DESIGN = 'zippyzack-pattern-last';
const uuid = () => crypto.randomUUID();
const clone = (doc: PatternDocument) => structuredClone(doc);
const dimensions = (stitch: DesignerStitch) => ({ width: stitch.size * 2, height: stitch.size * 4 });

async function request(path = '', options?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({ error: 'The server returned an unexpected response.' }));
  if (!response.ok) throw new Error(body.error || 'Could not save this pattern.');
  return body;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PatternDesigner() {
  const [doc, setDoc] = useState<PatternDocument>(emptyPattern);
  const docRef = useRef(doc);
  const idRef = useRef('');
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const initialized = useRef(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState('');
  const [localError, setLocalError] = useState('');
  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('svg');
  const [exportScale, setExportScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const [mode, setMode] = useState<'select' | 'pan'>('select');
  const [grid, setGrid] = useState(false);
  const [snap, setSnap] = useState(false);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const undo = useRef<PatternDocument[]>([]);
  const redo = useRef<PatternDocument[]>([]);
  const gesture = useRef<PatternDocument | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const moveable = useRef<Moveable>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ start: { x: number; y: number }; viewport: PatternDocument['viewport']; selecting: boolean; additive: boolean } | null>(null);
  const pinch = useRef<{ distance: number; centre: { x: number; y: number }; viewport: PatternDocument['viewport'] } | null>(null);

  function persist() {
    if (!idRef.current) return;
    try {
      const draft: Draft = { id: idRef.current, document: docRef.current, revision: revisionRef.current, dirty: dirtyRef.current, time: new Date().toISOString() };
      localStorage.setItem(DRAFT_PREFIX + idRef.current, JSON.stringify(draft));
      localStorage.setItem(LAST_DESIGN, idRef.current);
      setLocalError('');
    } catch {
      setLocalError('Local recovery storage is unavailable. Keep this tab open until saved, or export a JSON backup.');
    }
  }

  function remember(previous: PatternDocument) {
    undo.current = [...undo.current.slice(-79), clone(previous)];
    redo.current = [];
    setHistory({ undo: undo.current.length, redo: 0 });
  }

  function change(next: PatternDocument, record = true) {
    if (JSON.stringify(next) === JSON.stringify(docRef.current)) return;
    if (record) remember(docRef.current);
    docRef.current = next;
    generation.current += 1;
    dirtyRef.current = true;
    setDoc(next);
    setStatus('Unsaved changes');
    persist();
  }

  function install(document: PatternDocument, id: string, revision: number, dirty = false) {
    idRef.current = id;
    revisionRef.current = revision;
    dirtyRef.current = dirty;
    docRef.current = document;
    generation.current += 1;
    setDoc(document);
    setSelection([]);
    undo.current = [];
    redo.current = [];
    setHistory({ undo: 0, redo: 0 });
    setStatus(dirty ? 'Recovered unsaved changes' : revision ? 'Saved' : 'New pattern');
    setError('');
    persist();
  }

  async function refreshLibrary() {
    const drafts: DesignSummary[] = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(DRAFT_PREFIX)) continue;
        try {
          const draft: Draft = JSON.parse(localStorage.getItem(key)!);
          const document = parsePattern(draft.document);
          if (draft.dirty || draft.revision === 0) drafts.push({ id: draft.id, title: document.title, revision: draft.revision, updated_at: draft.time, local: true });
        } catch { continue; }
      }
    } catch { setLocalError('Local recovery storage is unavailable.'); }
    try {
      const cloud: DesignSummary[] = await request();
      setDesigns([...drafts, ...cloud.filter(design => !drafts.some(draft => draft.id === design.id))]);
    } catch (reason) { setDesigns(drafts); setError((reason as Error).message); }
  }

  async function save(force = false) {
    if (!idRef.current || savingRef.current || (!dirtyRef.current && !force) || gesture.current) return;
    savingRef.current = true;
    const id = idRef.current;
    const savedGeneration = generation.current;
    const snapshot = clone(docRef.current);
    setStatus('Saving...');
    try {
      const saved: StoredDesign = await request(`/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: snapshot, revision: revisionRef.current }),
      });
      if (idRef.current === id) {
        revisionRef.current = saved.revision;
        dirtyRef.current = generation.current !== savedGeneration;
        setStatus(dirtyRef.current ? 'Unsaved changes' : `Saved ${new Date(saved.updated_at).toLocaleTimeString()}`);
        setError('');
        persist();
      }
      setDesigns(previous => [saved, ...previous.filter(design => design.id !== id)]);
    } catch (reason) {
      if (idRef.current === id) {
        dirtyRef.current = true;
        setStatus('Save failed');
        setError((reason as Error).message);
        persist();
      }
    } finally { savingRef.current = false; }
  }

  async function openDesign(id: string) {
    if (savingRef.current) { setError('Wait for the current save to finish before opening another pattern.'); return; }
    persist();
    let draft: Draft | null = null;
    try {
      const value = localStorage.getItem(DRAFT_PREFIX + id);
      if (value) {
        draft = JSON.parse(value);
        if (draft) draft.document = parsePattern(draft.document);
      }
    } catch { setError('The local draft could not be read.'); }
    if (draft && draft.revision === 0) {
      install(draft.document, id, 0, draft.dirty);
      setLibraryOpen(false);
      return;
    }
    try {
      const saved: StoredDesign = await request(`/${id}`);
      if (draft?.dirty && window.confirm('Recover the unsaved local draft? Cancel opens the saved cloud version.')) {
        install(draft.document, id, draft.revision, true);
        if (draft.revision !== saved.revision) setError('The cloud version has changed. Duplicate this recovered pattern to save it separately, or reopen the cloud version.');
      } else install(parsePattern(saved.document), id, saved.revision);
    } catch (reason) {
      if (draft) install(draft.document, id, draft.revision, draft.dirty);
      setError((reason as Error).message);
    }
    setLibraryOpen(false);
  }

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_DESIGN); } catch { setLocalError('Local recovery storage is unavailable.'); }
      if (last) void openDesign(last).finally(() => setReady(true));
      else { idRef.current = uuid(); persist(); setReady(true); }
      void refreshLibrary();
    }
    const interval = window.setInterval(() => { void save(); }, 5000);
    const leaving = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leaving);
    return () => { window.clearInterval(interval); window.removeEventListener('beforeunload', leaving); };
  }, []);

  useEffect(() => {
    const elements = [...(board.current?.querySelectorAll<HTMLElement>('[data-stitch-id]') ?? [])];
    setTargets(elements.filter(element => selection.includes(element.dataset.stitchId ?? '')));
  }, [selection, doc.stitches.length]);

  useEffect(() => { moveable.current?.updateRect(); }, [doc, targets]);

  useEffect(() => {
    if (!libraryOpen && !exportOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('.designer-modal');
    const focusable = () => [...(modal?.querySelectorAll<HTMLElement>('button:not(:disabled), select, input') ?? [])];
    focusable()[0]?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) { setLibraryOpen(false); setExportOpen(false); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); previous?.focus(); };
  }, [libraryOpen, exportOpen, exporting]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, select, textarea, button') || libraryOpen || exportOpen) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 's') { event.preventDefault(); void save(true); }
      else if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey); }
      else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); travel(true); }
      else if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); }
      else if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelection(docRef.current.stitches.map(stitch => stitch.id)); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelection(); }
      else if (event.key === 'Escape') { setSelection([]); setMode('select'); }
      else if (event.key.startsWith('Arrow') && selection.length) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0;
        const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0;
        change({ ...docRef.current, stitches: docRef.current.stitches.map(stitch => selection.includes(stitch.id) ? { ...stitch, x: stitch.x + dx, y: stitch.y + dy } : stitch) });
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [selection, libraryOpen, exportOpen]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      change({ ...docRef.current, viewport: zoomAt(docRef.current.viewport, point, docRef.current.viewport.zoom * Math.exp(-event.deltaY * 0.002)) }, false);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [ready]);

  function travel(forward: boolean) {
    const source = forward ? redo : undo;
    const destination = forward ? undo : redo;
    const next = source.current.pop();
    if (!next) return;
    destination.current.push(clone(docRef.current));
    change({ ...next, viewport: docRef.current.viewport }, false);
    setSelection([]);
    setHistory({ undo: undo.current.length, redo: redo.current.length });
  }

  function add(kind: DesignerStitch['kind'], point?: { x: number; y: number }) {
    const centre = point ?? canvasPoint({ x: (stage.current?.clientWidth ?? 800) / 2, y: (stage.current?.clientHeight ?? 600) / 2 }, docRef.current.viewport);
    const stitch: DesignerStitch = { id: uuid(), kind, x: Math.max(0, Math.min(doc.width, centre.x)), y: Math.max(0, Math.min(doc.height, centre.y)), angle: 0, size: 24, colour: '#1f2a2a' };
    change({ ...docRef.current, stitches: [...docRef.current.stitches, stitch] });
    setSelection([stitch.id]);
    setMode('select');
  }

  function removeSelection() {
    if (!selection.length) return;
    change({ ...docRef.current, stitches: docRef.current.stitches.filter(stitch => !selection.includes(stitch.id)) });
    setSelection([]);
  }

  function duplicateSelection() {
    const copies = docRef.current.stitches.filter(stitch => selection.includes(stitch.id)).map(stitch => ({ ...stitch, id: uuid(), x: stitch.x + 20, y: stitch.y + 20 }));
    if (!copies.length) return;
    change({ ...docRef.current, stitches: [...docRef.current.stitches, ...copies] });
    setSelection(copies.map(stitch => stitch.id));
  }

  function editSelected(patch: Partial<DesignerStitch>) {
    change({ ...docRef.current, stitches: docRef.current.stitches.map(stitch => selection.includes(stitch.id) ? { ...stitch, ...patch } : stitch) });
  }

  function startGesture() { gesture.current = clone(docRef.current); }
  function endGesture() {
    if (gesture.current && JSON.stringify(gesture.current.stitches) !== JSON.stringify(docRef.current.stitches)) remember(gesture.current);
    gesture.current = null;
  }

  function transform(events: { target: HTMLElement | SVGElement; left?: number; top?: number; beforeRotate?: number; drag?: { left: number; top: number } }[]) {
    const updates = new Map(events.map(event => [event.target.getAttribute('data-stitch-id'), event]));
    change({ ...docRef.current, stitches: docRef.current.stitches.map(stitch => {
      const event = updates.get(stitch.id);
      if (!event) return stitch;
      const size = dimensions(stitch);
      const left = event.drag?.left ?? event.left;
      const top = event.drag?.top ?? event.top;
      const rounding = (value: number) => snap ? Math.round(value / 10) * 10 : value;
      return { ...stitch, x: left === undefined ? stitch.x : rounding(left + size.width / 2), y: top === undefined ? stitch.y : rounding(top + size.height / 2), angle: event.beforeRotate === undefined ? stitch.angle : ((event.beforeRotate % 360) + 360) % 360 };
    }) }, false);
  }

  function pointAt(event: { clientX: number; clientY: number }) {
    const rect = stage.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const point = pointAt(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), centre: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, viewport: { ...docRef.current.viewport } };
      pan.current = null;
      setBox(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if ((event.target as HTMLElement).closest('.designer-stitch, .moveable-control-box') && mode !== 'pan') return;
    if (event.button !== 0 && event.button !== 1) return;
    const selecting = mode === 'select' && event.button === 0 && event.pointerType !== 'touch';
    pan.current = { start: point, viewport: { ...docRef.current.viewport }, selecting, additive: event.shiftKey };
    if (selecting && !event.shiftKey) setSelection([]);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const point = pointAt(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point);
    if (pinch.current && pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      const centre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const view = zoomAt(pinch.current.viewport, pinch.current.centre, pinch.current.viewport.zoom * Math.hypot(first.x - second.x, first.y - second.y) / Math.max(1, pinch.current.distance));
      change({ ...docRef.current, viewport: { ...view, x: view.x + centre.x - pinch.current.centre.x, y: view.y + centre.y - pinch.current.centre.y } }, false);
      return;
    }
    if (!pan.current) return;
    const { start, viewport, selecting } = pan.current;
    if (selecting) setBox({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
    else change({ ...docRef.current, viewport: { ...viewport, x: viewport.x + point.x - start.x, y: viewport.y + point.y - start.y } }, false);
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pinch.current) { pinch.current = null; pan.current = null; }
    if (pan.current?.selecting && box) {
      const additive = pan.current.additive;
      const first = canvasPoint({ x: box.x, y: box.y }, docRef.current.viewport);
      const last = canvasPoint({ x: box.x + box.width, y: box.y + box.height }, docRef.current.viewport);
      const ids = docRef.current.stitches.filter(stitch => stitch.x >= first.x && stitch.x <= last.x && stitch.y >= first.y && stitch.y <= last.y).map(stitch => stitch.id);
      setSelection(previous => additive ? [...new Set([...previous, ...ids])] : ids);
    }
    pan.current = null;
    setBox(null);
  }

  function zoom(factor: number) {
    change({ ...docRef.current, viewport: zoomAt(docRef.current.viewport, { x: (stage.current?.clientWidth ?? 800) / 2, y: (stage.current?.clientHeight ?? 600) / 2 }, docRef.current.viewport.zoom * factor) }, false);
  }

  function fit() {
    const width = stage.current?.clientWidth ?? 800;
    const height = stage.current?.clientHeight ?? 600;
    const zoom = Math.max(0.1, Math.min(5, (width - 60) / doc.width, (height - 60) / doc.height));
    change({ ...docRef.current, viewport: { zoom, x: (width - doc.width * zoom) / 2, y: (height - doc.height * zoom) / 2 } }, false);
  }

  function newDesign(duplicate = false) {
    if (savingRef.current) { setError('Wait for the current save to finish.'); return; }
    persist();
    const next = duplicate ? { ...clone(docRef.current), title: `${docRef.current.title.slice(0, 150)} copy` } : emptyPattern();
    install(next, uuid(), 0, duplicate);
  }

  async function deleteDesign(design: DesignSummary) {
    if (savingRef.current || !window.confirm(`Delete "${design.title}"? This cannot be undone.`)) return;
    try {
      if (design.revision > 0) await request(`/${design.id}?revision=${design.revision}`, { method: 'DELETE' });
      localStorage.removeItem(DRAFT_PREFIX + design.id);
      setDesigns(previous => previous.filter(item => item.id !== design.id));
      if (idRef.current === design.id) install(emptyPattern(), uuid(), 0);
    } catch (reason) { setError((reason as Error).message); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 3000000) throw new Error('The JSON backup is too large (maximum 3 MB).');
      const imported = parsePattern(JSON.parse(await file.text()));
      if (savingRef.current) throw new Error('Wait for the current save to finish.');
      persist();
      install(imported, uuid(), 0, true);
    } catch (reason) { setError((reason as Error).message); }
    if (fileInput.current) fileInput.current.value = '';
  }

  async function exportArtwork() {
    setExporting(true);
    try {
      const snapshot = parsePattern(docRef.current);
      const name = snapshot.title.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'pattern';
      if (exportFormat === 'json') download(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), `${name}.json`);
      else {
        const svg = patternSvg(snapshot, transparent && exportFormat !== 'pdf');
        if (exportFormat === 'svg') download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
        else if (exportFormat === 'pdf') {
          const { jsPDF } = await import('jspdf');
          await import('svg2pdf.js');
          const pdf = new jsPDF({ orientation: snapshot.width >= snapshot.height ? 'landscape' : 'portrait', unit: 'pt', format: [snapshot.width * 0.75, snapshot.height * 0.75] });
          const element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
          await pdf.svg(element as unknown as SVGElement, { x: 0, y: 0, width: snapshot.width * 0.75, height: snapshot.height * 0.75 });
          pdf.save(`${name}.pdf`);
        } else {
          const width = Math.round(snapshot.width * exportScale);
          const height = Math.round(snapshot.height * exportScale);
          if (width > 16384 || height > 16384 || width * height > 64000000) throw new Error('This PNG is too large. Reduce resolution or use SVG/PDF.');
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('PNG export is unavailable in this browser.');
            context.drawImage(image, 0, 0, width, height);
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed.')), 'image/png'));
            download(blob, `${name}.png`);
          } finally { URL.revokeObjectURL(url); }
        }
      }
      setExportOpen(false);
    } catch (reason) { setError((reason as Error).message); }
    finally { setExporting(false); }
  }

  const selected = doc.stitches.filter(stitch => selection.includes(stitch.id));
  const first = selected[0];
  const iconButton = (label: string, Icon: typeof Save, action: () => void, disabled = false, active = false) => (
    <button type="button" className={`designer-icon ${active ? 'is-active' : ''}`} title={label} aria-label={label} onClick={action} disabled={disabled}><Icon size={18} /></button>
  );

  return <section className="pattern-designer" aria-label="Pattern designer">
    <header className="designer-header">
      <div><h1>Pattern designer</h1><span className="designer-count">{doc.stitches.length} {doc.stitches.length === 1 ? 'stitch' : 'stitches'}</span></div>
      <div className="designer-file-actions">
        {iconButton('New pattern', FilePlus2, () => newDesign())}
        {iconButton('Open patterns', FolderOpen, () => { setLibraryOpen(true); void refreshLibrary(); })}
        {iconButton('Duplicate pattern', Copy, () => newDesign(true))}
        {iconButton('Import JSON backup', Upload, () => fileInput.current?.click())}
        <button type="button" className="designer-command" onClick={() => void save(true)} disabled={!ready || status === 'Saving...'}><Save size={17} /> Save</button>
        <button type="button" className="designer-command primary" onClick={() => setExportOpen(true)}><Download size={17} /> Export</button>
      </div>
    </header>
    <div className="designer-document-bar">
      <input aria-label="Pattern name" value={doc.title} maxLength={160} onChange={event => change({ ...docRef.current, title: event.target.value || 'Untitled pattern' })} />
      <span role="status" className={status === 'Save failed' ? 'designer-failed' : ''}>{status}</span>
    </div>
    {(error || localError) && <div className="designer-error" role="alert">{error && <span>{error}</span>}{localError && <span>{localError}</span>}<button type="button" onClick={() => setError('')} aria-label="Dismiss message">Close</button></div>}
    <div className="designer-toolbar">
      <div className="designer-tool-group">
        {iconButton('Select stitches', MousePointer2, () => setMode('select'), false, mode === 'select')}
        {iconButton('Pan canvas', Hand, () => setMode('pan'), false, mode === 'pan')}
        {iconButton('Undo', Undo2, () => travel(false), !history.undo)}
        {iconButton('Redo', Redo2, () => travel(true), !history.redo)}
        {iconButton('Duplicate selected stitches', Copy, duplicateSelection, !selection.length)}
        {iconButton('Delete selected stitches', Trash2, removeSelection, !selection.length)}
      </div>
      <div className="designer-tool-group">
        <label><input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} /> Grid</label>
        <label><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} /> Snap</label>
        {iconButton('Zoom out', ZoomOut, () => zoom(1 / 1.2))}
        <button type="button" className="designer-zoom" title="Reset zoom to 100%" onClick={() => change({ ...docRef.current, viewport: zoomAt(docRef.current.viewport, { x: (stage.current?.clientWidth ?? 800) / 2, y: (stage.current?.clientHeight ?? 600) / 2 }, 1) }, false)}>{Math.round(doc.viewport.zoom * 100)}%</button>
        {iconButton('Zoom in', ZoomIn, () => zoom(1.2))}
        {iconButton('Fit artwork', Maximize, fit)}
      </div>
    </div>
    <div className="designer-workspace">
      <aside className="designer-palette" aria-label="Stitch palette">
        <h2>Stitches</h2>
        <div className="designer-symbols">{DESIGN_KINDS.map(kind => <button key={kind} type="button" draggable title={SYMBOL_NAMES[kind]} aria-label={`Add ${SYMBOL_NAMES[kind]}`} onClick={() => add(kind)} onDragStart={event => { event.dataTransfer.setData('application/x-crochet-stitch', kind); event.dataTransfer.effectAllowed = 'copy'; }}>
          <svg viewBox="-24 -48 48 96" aria-hidden="true" dangerouslySetInnerHTML={{ __html: stitchSvg({ id: '', kind, x: 0, y: 0, angle: 0, size: 24, colour: '#1f2a2a' }) }} />
          <span>{kind}</span>
        </button>)}</div>
      </aside>
      <div ref={stage} className={`designer-stage ${mode === 'pan' ? 'is-panning' : ''}`} tabIndex={0} aria-label="Pattern canvas" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={event => {
        event.preventDefault();
        const kind = event.dataTransfer.getData('application/x-crochet-stitch');
        if (DESIGN_KINDS.includes(kind as DesignerStitch['kind'])) add(kind as DesignerStitch['kind'], canvasPoint(pointAt(event), docRef.current.viewport));
      }}>
        <div ref={board} className={`designer-board ${grid ? 'with-grid' : ''}`} style={{ width: doc.width, height: doc.height, transform: `translate(${doc.viewport.x}px, ${doc.viewport.y}px) scale(${doc.viewport.zoom})` }}>
          {doc.stitches.map(stitch => {
            const size = dimensions(stitch);
            return <div key={stitch.id} data-stitch-id={stitch.id} role="button" tabIndex={0} aria-label={`${SYMBOL_NAMES[stitch.kind]} stitch`} aria-pressed={selection.includes(stitch.id)} className={`designer-stitch ${selection.includes(stitch.id) ? 'selected' : ''}`} style={{ width: size.width, height: size.height, left: stitch.x - size.width / 2, top: stitch.y - size.height / 2, transform: `rotate(${stitch.angle}deg)` }} onPointerDown={event => {
              if (mode === 'pan') return;
              if (!selection.includes(stitch.id)) {
                setSelection(event.shiftKey ? [...selection, stitch.id] : [stitch.id]);
                if (!event.shiftKey) void moveable.current?.waitToChangeTarget().then(() => moveable.current?.dragStart(event.nativeEvent));
              }
              else if (event.shiftKey) setSelection(selection.filter(id => id !== stitch.id));
            }} onKeyDown={event => { if (event.key === 'Enter') setSelection(event.shiftKey ? [...new Set([...selection, stitch.id])] : [stitch.id]); }}>
              <svg viewBox="-24 -48 48 96" aria-hidden="true" dangerouslySetInnerHTML={{ __html: stitchSvg(stitch) }} />
            </div>;
          })}
        </div>
        <Moveable ref={moveable} target={mode === 'select' ? targets : []} draggable rotatable origin={false} throttleRotate={0} rotationPosition="top" hideDefaultLines={false} onDragStart={startGesture} onDragGroupStart={startGesture} onRotateStart={startGesture} onRotateGroupStart={startGesture} onDrag={event => transform([event])} onDragGroup={event => transform(event.events)} onRotate={event => transform([event])} onRotateGroup={event => transform(event.events)} onDragEnd={endGesture} onDragGroupEnd={endGesture} onRotateEnd={endGesture} onRotateGroupEnd={endGesture} />
        {box && <div className="designer-selection-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}
      </div>
      <aside className="designer-inspector">
        <h2>{selection.length ? `Selection (${selection.length})` : 'Artwork'}</h2>
        {first ? <>
          {selected.length === 1 && <div className="designer-field-pair">
            <label>X<input type="number" value={Math.round(first.x * 10) / 10} min={-100000} max={100000} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && Math.abs(value) <= 100000) editSelected({ x: value }); }} /></label>
            <label>Y<input type="number" value={Math.round(first.y * 10) / 10} min={-100000} max={100000} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && Math.abs(value) <= 100000) editSelected({ y: value }); }} /></label>
          </div>}
          <label>Rotation<input aria-label="Stitch rotation" type="number" step="0.1" value={Math.round(first.angle * 10) / 10} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) editSelected({ angle: ((value % 360) + 360) % 360 }); }} /></label>
          <label>Size<input aria-label="Stitch size" type="number" min={4} max={500} value={first.size} onChange={event => { const value = Number(event.target.value); if (value >= 4 && value <= 500) editSelected({ size: value }); }} /></label>
          <label>Colour<input aria-label="Stitch colour" type="color" value={first.colour} onChange={event => editSelected({ colour: event.target.value })} /></label>
          <div className="designer-tool-group">
            {iconButton('Bring selection to front', ArrowUp, () => change({ ...docRef.current, stitches: [...docRef.current.stitches.filter(stitch => !selection.includes(stitch.id)), ...selected] }))}
            {iconButton('Send selection to back', ArrowDown, () => change({ ...docRef.current, stitches: [...selected, ...docRef.current.stitches.filter(stitch => !selection.includes(stitch.id))] }))}
          </div>
        </> : <div className="designer-field-pair">
          <label>Width<input aria-label="Artwork width" type="number" min={100} max={10000} value={doc.width} onChange={event => { const value = Number(event.target.value); if (value >= 100 && value <= 10000) change({ ...docRef.current, width: value }); }} /></label>
          <label>Height<input aria-label="Artwork height" type="number" min={100} max={10000} value={doc.height} onChange={event => { const value = Number(event.target.value); if (value >= 100 && value <= 10000) change({ ...docRef.current, height: value }); }} /></label>
        </div>}
      </aside>
    </div>
    <input ref={fileInput} type="file" accept="application/json,.json" className="designer-hidden" onChange={event => void importFile(event.target.files?.[0])} />
    {libraryOpen && <div className="designer-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="Saved patterns" className="designer-modal">
      <header><h2>Saved patterns</h2><button type="button" onClick={() => setLibraryOpen(false)}>Close</button></header>
      {designs.length === 0 && <p>No saved patterns.</p>}
      <div className="designer-library">{designs.map(design => <div key={design.id} data-design-id={design.id}><button type="button" onClick={() => void openDesign(design.id)}><strong>{design.title}</strong><span>{design.local ? 'Local draft - ' : ''}{new Date(design.updated_at).toLocaleString()}</span></button>{iconButton(`Delete ${design.title}`, Trash2, () => void deleteDesign(design))}</div>)}</div>
    </section></div>}
    {exportOpen && <div className="designer-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="Export artwork" className="designer-modal">
      <header><h2>Export artwork</h2><button type="button" disabled={exporting} onClick={() => setExportOpen(false)}>Close</button></header>
      <label>Format<select aria-label="Export format" value={exportFormat} onChange={event => setExportFormat(event.target.value)}><option value="svg">SVG</option><option value="png">PNG</option><option value="pdf">PDF</option><option value="json">JSON backup</option></select></label>
      {exportFormat === 'png' && <label>Resolution<select aria-label="PNG resolution" value={exportScale} onChange={event => setExportScale(Number(event.target.value))}><option value={1}>1x</option><option value={2}>2x</option><option value={3}>3x</option></select></label>}
      {['png', 'svg'].includes(exportFormat) && <label className="designer-check"><input type="checkbox" checked={transparent} onChange={event => setTransparent(event.target.checked)} /> Transparent background</label>}
      <button type="button" className="designer-command primary" disabled={exporting} onClick={() => void exportArtwork()}><Download size={17} />{exporting ? 'Exporting...' : 'Download'}</button>
    </section></div>}
  </section>;
}