/*
 * The basket, as the browser holds it.
 *
 * Three rules shape everything here:
 *
 *  1. This file never decides what anything costs. The snapshot below is for
 *     drawing a row before the server answers — nothing more. Every total that
 *     reaches an order is recomputed from the database in lib/orders.ts, because
 *     localStorage is a text file the customer can edit.
 *
 *  2. The shop sells kits — makes and bundles — never a loose product. A kit is
 *     one line, not a pile of parts: its price comes from the kit's discount on
 *     the whole, which adding the parts separately would quietly throw away.
 *
 *  3. A line is a kit *and* the tools left out of it. The same kit with and
 *     without its hook is two different things to pack, so it is two lines.
 */

export const CART_KEY = 'zz_cart_v1';
export const CART_EVENT = 'cart:changed';

/**
 * 'bundle' is a kit to make, a make or a bundle alike. 'made' is a kit bought
 * as the completed product instead: nothing left out, and its own price.
 */
export type LineKind = 'bundle' | 'made';

/** Enough to draw the row instantly. Re-read from the server before it counts. */
export interface LineSnapshot {
  name: string;
  price: number;
  image: string | null;
  href: string;
  /** Names of the tools left out, to show under the line. */
  omitted?: string[];
}

export interface CartLine {
  kind: LineKind;
  /** The make or bundle id. */
  id: string;
  qty: number;
  /** Product ids the customer chose to leave out, sorted. */
  omit?: string[];
  snap: LineSnapshot;
}

const sortedOmit = (omit: string[] | undefined) => [...new Set(omit ?? [])].sort();

/** A line is its kind, its kit and what was left out, together. The server keys on the same thing. */
export const lineKey = (kind: LineKind, id: string, omit?: string[]) =>
  `${kind}:${id}:${sortedOmit(omit).join(',')}`;

const keyOf = (line: CartLine) => lineKey(line.kind, line.id, line.omit);

function isLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Record<string, unknown>;
  const snap = line.snap as Record<string, unknown> | undefined;
  return (
    (line.kind === 'bundle' || line.kind === 'made') &&
    typeof line.id === 'string' &&
    typeof line.qty === 'number' &&
    Number.isFinite(line.qty) &&
    line.qty > 0 &&
    (line.omit === undefined || (Array.isArray(line.omit) && line.omit.every((o) => typeof o === 'string'))) &&
    !!snap &&
    typeof snap.name === 'string' &&
    typeof snap.href === 'string'
  );
}

/**
 * Anything unparseable is thrown away rather than repaired. A corrupt basket
 * is an empty basket; the alternative is a checkout that fails at the till.
 * That includes loose products saved before the shop stopped selling them on
 * their own: they can no longer be bought, and keeping them would stop the
 * whole basket at checkout.
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

/**
 * Adds a kit, less `omit`, or the completed product when `kind` is 'made'.
 * Adds to the quantity when that exact line is already there.
 */
export function addToCart(
  id: string,
  snap: LineSnapshot,
  omit: string[] = [],
  qty = 1,
  kind: LineKind = 'bundle',
): void {
  const lines = readCart();
  const line: CartLine = { kind, id, qty, omit: kind === 'made' ? [] : sortedOmit(omit), snap };
  const existing = lines.find((l) => keyOf(l) === keyOf(line));
  if (existing) {
    existing.qty += qty;
    // The name or price may have changed since it went in; the fresher one wins.
    existing.snap = snap;
  } else {
    lines.push(line);
  }
  writeCart(lines);
}

export function setQty(key: string, qty: number): void {
  const lines = readCart();
  const line = lines.find((l) => keyOf(l) === key);
  if (!line) return;
  if (qty <= 0) return removeLine(key);
  line.qty = Math.min(99, Math.round(qty));
  writeCart(lines);
}

export function removeLine(key: string): void {
  writeCart(readCart().filter((l) => keyOf(l) !== key));
}

export function clearCart(): void {
  writeCart([]);
}

/** Each line's key, for the rows that edit it. */
export const cartLineKey = keyOf;

/** What the pricing endpoints accept — the snapshot is deliberately not sent. */
export const toRequest = (lines = readCart()) =>
  lines.map(({ kind, id, qty, omit }) => ({ kind, id, qty, omit: sortedOmit(omit) }));
