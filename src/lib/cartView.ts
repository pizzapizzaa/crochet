/*
 * Drawing the basket, in the browser.
 *
 * The drawer and the /cart page show the same rows at different sizes, so the
 * row markup and the fetch live here rather than being written twice and
 * drifting apart. Nothing in this file decides a price — it renders whatever
 * /api/shop/cart-price answered, which is the only figure that counts.
 */

import { readCart, toRequest, type CartLine } from './cart';
import { ON_IMG_ERROR, productImage } from './images';

export interface PricedLineView {
  kind: 'product' | 'bundle';
  id: string;
  name: string;
  href: string;
  image: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  compareAt: number | null;
}

export interface ProblemView {
  id: string;
  name: string;
  reason: 'gone' | 'stock';
  message: string;
}

export interface PricedCartView {
  lines: PricedLineView[];
  subtotal: number;
  shipping: number;
  total: number;
  problems: ProblemView[];
}

export const EMPTY: PricedCartView = {
  lines: [],
  subtotal: 0,
  shipping: 0,
  total: 0,
  problems: [],
};

export const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

/** Ask the server what the basket is worth. Returns null if it could not say. */
export async function fetchPricing(lines: CartLine[] = readCart()): Promise<PricedCartView | null> {
  if (lines.length === 0) return EMPTY;
  try {
    const response = await fetch('/api/shop/cart-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: toRequest(lines) }),
    });
    if (!response.ok) return null;
    return (await response.json()) as PricedCartView;
  } catch {
    return null;
  }
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * One row. `compact` is the drawer; the full version is the /cart page, which
 * has the width for a per-item price and a line total side by side.
 */
export function lineRow(line: PricedLineView, compact: boolean): string {
  const image = productImage(line.image);
  const name = escapeHtml(line.name);
  const size = compact ? 'h-16 w-16' : 'h-20 w-20 sm:h-24 sm:w-24';

  return `
    <li class="flex gap-3 py-4" data-kind="${line.kind}" data-id="${line.id}">
      <a href="${line.href}" class="shrink-0">
        <img src="${escapeHtml(image)}" onerror="${ON_IMG_ERROR}" alt="" class="${size} rounded-field object-cover" loading="lazy" />
      </a>
      <div class="min-w-0 flex-1">
        <a href="${line.href}" class="block font-display text-sm font-bold leading-snug text-ink transition-colors duration-fast ease-out hover:text-mint-deep">
          ${name}
        </a>
        <p class="mt-0.5 text-xs text-ink-muted">
          ${money(line.unitPrice)} each
          ${line.compareAt ? `<span class="ml-1 line-through opacity-70">${money(line.compareAt)}</span>` : ''}
        </p>

        <div class="mt-2 flex items-center gap-2">
          <div class="inline-flex items-center rounded-pill border border-cream-300 bg-paper">
            <button type="button" data-step="-1" aria-label="One fewer ${name}"
              class="rounded-l-pill px-2.5 py-1 text-sm font-bold text-ink-body transition-colors duration-fast ease-out hover:bg-cream-100">−</button>
            <span class="min-w-[2ch] px-1 text-center text-xs font-bold text-ink" data-qty>${line.qty}</span>
            <button type="button" data-step="1" aria-label="One more ${name}"
              class="rounded-r-pill px-2.5 py-1 text-sm font-bold text-ink-body transition-colors duration-fast ease-out hover:bg-cream-100">+</button>
          </div>
          <button type="button" data-remove
            class="rounded-field px-2 py-1 text-xs font-bold text-ink-muted transition-colors duration-fast ease-out hover:bg-lemon-wash hover:text-lemon-deep">
            Remove
          </button>
        </div>
      </div>
      <p class="shrink-0 font-display text-sm font-extrabold text-ink">${money(line.lineTotal)}</p>
    </li>
  `;
}

export function problemBanner(problems: ProblemView[]): string {
  if (problems.length === 0) return '';
  const items = problems.map((p) => `<li>${escapeHtml(p.message)}</li>`).join('');
  return `
    <div class="mb-4 rounded-card border border-lemon-soft bg-lemon-wash px-4 py-3">
      <p class="text-xs font-bold uppercase tracking-eyebrow text-lemon-deep">Before you pay</p>
      <ul class="mt-1.5 list-disc space-y-1 pl-4 text-sm text-ink-body">${items}</ul>
    </div>
  `;
}
