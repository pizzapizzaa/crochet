import type { Product } from './database.types';

/*
 * The arithmetic behind /pos/materials. Kept out of the page so the numbers in
 * a bundle preview and the numbers in the cost table are the same numbers.
 *
 * Margin vs markup is the thing people get wrong, so both are here explicitly:
 *   margin = profit / price   — the share of the sale we keep
 *   markup = profit / cost    — how far we moved the price above cost
 * A $10 item bought for $5 is a 50% margin and a 100% markup.
 */

export interface Costing {
  product: Product;
  cost: number | null;
  price: number;
  /** Null whenever the cost is unknown — never zero, which would read as free. */
  profitPerUnit: number | null;
  marginPct: number | null;
  markupPct: number | null;
  stockAtCost: number | null;
  stockAtRetail: number;
  /** profit x stock: what is still sitting on the shelf. */
  potentialProfit: number | null;
  /** profit x units_sold: what has already been banked. */
  realisedProfit: number | null;
  revenue: number;
  /** True when we are selling at or below what we paid. */
  isLoss: boolean;
  hasCost: boolean;
}

export function costing(product: Product): Costing {
  const price = Number(product.price) || 0;
  const rawCost = product.cost_price;
  const hasCost = rawCost !== null && rawCost !== undefined;
  const cost = hasCost ? Number(rawCost) : null;

  const profitPerUnit = cost === null ? null : price - cost;
  const stock = Number(product.stock) || 0;
  const sold = Number(product.units_sold) || 0;

  return {
    product,
    cost,
    price,
    profitPerUnit,
    marginPct: profitPerUnit === null || price === 0 ? null : (profitPerUnit / price) * 100,
    markupPct: profitPerUnit === null || cost === 0 ? null : (profitPerUnit / cost!) * 100,
    stockAtCost: cost === null ? null : cost * stock,
    stockAtRetail: price * stock,
    potentialProfit: profitPerUnit === null ? null : profitPerUnit * stock,
    realisedProfit: profitPerUnit === null ? null : profitPerUnit * sold,
    revenue: price * sold,
    isLoss: profitPerUnit !== null && profitPerUnit <= 0,
    hasCost,
  };
}

export interface CostingTotals {
  priced: number;
  unpriced: number;
  stockAtCost: number;
  stockAtRetail: number;
  potentialProfit: number;
  realisedProfit: number;
  revenue: number;
  /** Blended margin across everything with a cost on file. */
  blendedMarginPct: number | null;
}

/**
 * Rolls a list up. Rows with no cost contribute to `unpriced` and to nothing
 * else — a blended margin that quietly treated unknown costs as zero would
 * flatter every total on the page.
 */
export function totals(rows: Costing[]): CostingTotals {
  const withCost = rows.filter((r) => r.hasCost);

  const stockAtCost = withCost.reduce((s, r) => s + (r.stockAtCost ?? 0), 0);
  const stockAtRetail = withCost.reduce((s, r) => s + r.stockAtRetail, 0);
  const revenue = withCost.reduce((s, r) => s + r.revenue, 0);
  const realisedProfit = withCost.reduce((s, r) => s + (r.realisedProfit ?? 0), 0);

  return {
    priced: withCost.length,
    unpriced: rows.length - withCost.length,
    stockAtCost,
    stockAtRetail,
    potentialProfit: withCost.reduce((s, r) => s + (r.potentialProfit ?? 0), 0),
    realisedProfit,
    revenue,
    blendedMarginPct:
      stockAtRetail > 0 ? ((stockAtRetail - stockAtCost) / stockAtRetail) * 100 : null,
  };
}

/** Health band for a margin, used to colour the row. */
export type MarginBand = 'unknown' | 'loss' | 'thin' | 'ok' | 'strong';

export function marginBand(c: Costing): MarginBand {
  if (c.marginPct === null) return 'unknown';
  if (c.profitPerUnit !== null && c.profitPerUnit <= 0) return 'loss';
  if (c.marginPct < 25) return 'thin';
  if (c.marginPct < 45) return 'ok';
  return 'strong';
}

export const BAND_LABEL: Record<MarginBand, string> = {
  unknown: 'No cost yet',
  loss: 'At a loss',
  thin: 'Thin',
  ok: 'Healthy',
  strong: 'Strong',
};

/** Fill-first classes, per the design system rule that lemon and mint are fills. */
export const BAND_CLASS: Record<MarginBand, string> = {
  unknown: 'bg-cream-200 text-ink-muted',
  loss: 'bg-lemon-deep text-cream',
  thin: 'bg-lemon-soft text-lemon-deep',
  ok: 'bg-mint-wash text-mint-deep',
  strong: 'bg-mint text-ink',
};

export const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money0 = (n: number) =>
  '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export const pct = (n: number | null) => (n === null ? '—' : n.toFixed(1) + '%');
