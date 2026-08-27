/*
 * The basket, as the browser holds it.
 *
 * Two rules shape everything here:
 *
 *  1. This file never decides what anything costs. The snapshot below is for
 *     drawing a row before the server answers — nothing more. Every total that
 *     reaches an order is recomputed from the database in lib/orders.ts, because
 *     localStorage is a text file the customer can edit.
 *
 *  2. A make's bundle is one line, not a pile of loose products. Its price comes
 *     from bundle_discount_pct applied to the whole; adding the parts separately
 *     would quietly charge full price for the saving the make page advertises.
 */

export const CART_KEY = 'zz_cart_v1';
export const CART_EVENT = 'cart:changed';

export type LineKind = 'product' | 'bundle';

/** Enough to draw the row instantly. Re-read from the server before it counts. */
export interface LineSnapshot {
  name: string;
  price: number;
  image: string | null;
  href: string;
}

export interface CartLine {
  kind: LineKind;
  /** A product id, or a make id for a bundle. */
  id: string;
  qty: number;
  snap: LineSnapshot;
}

/** A line is identified by kind and id together — a make and a product could share neither, but the pair is what the server keys on too. */
export const lineKey = (kind: LineKind, id: string) => `${kind}:${id}`;

function isLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Record<string, unknown>;
  const snap = line.snap as Record<string, unknown> | undefined;
  return (
    (line.kind === 'product' || line.kind === 'bundle') &&
    typeof line.id === 'string' &&
    typeof line.qty === 'number' &&
    Number.isFinite(line.qty) &&
    line.qty > 0 &&
    !!snap &&
    typeof snap.name === 'string' &&
    typeof snap.href === 'string'
  );
}

/**
 * Anything unparseable is thrown away rather than repaired. A corrupt basket
 * is an empty basket; the alternative is a checkout that fails at the till.
 */
export function readCart(): CartLine[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch {
    return [];
  }
}

function writeCart(lines: CartLine[]): void {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(lines));
  } catch {
    // A full or blocked store (private mode) is not worth breaking the page over.
  }
  // The header badge, the drawer and the cart page all redraw off this one event.
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: lines }));
}

export function cartCount(lines = readCart()): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

/** Adds to the quantity when the line is already there, rather than repeating it. */
export function addToCart(kind: LineKind, id: string, snap: LineSnapshot, qty = 1): void {
  const lines = readCart();
  const existing = lines.find((l) => l.kind === kind && l.id === id);
  if (existing) {
    existing.qty += qty;
    // The name or price may have changed since it went in; the fresher one wins.
    existing.snap = snap;
  } else {
    lines.push({ kind, id, qty, snap });
  }
  writeCart(lines);
}

export function setQty(kind: LineKind, id: string, qty: number): void {
  const lines = readCart();
  const line = lines.find((l) => l.kind === kind && l.id === id);
  if (!line) return;
  if (qty <= 0) return removeLine(kind, id);
  line.qty = Math.min(99, Math.round(qty));
  writeCart(lines);
}

export function removeLine(kind: LineKind, id: string): void {
  writeCart(readCart().filter((l) => !(l.kind === kind && l.id === id)));
}

export function clearCart(): void {
  writeCart([]);
}

/** What the pricing endpoints accept — the snapshot is deliberately not sent. */
export const toRequest = (lines = readCart()) =>
  lines.map(({ kind, id, qty }) => ({ kind, id, qty }));
