import { VND_PER_USD } from './orders';

/*
 * Turning a supplier's price into ours.
 *
 * The catalogue is priced in USD. Almost nothing we import is: the yarn comes
 * from Chinese shops quoting CNY, and the odd thing from Europe or Japan quotes
 * its own. Before this existed, a ¥120 skein landed in the catalogue as $120,
 * because the importer read the number and ignored the symbol in front of it.
 *
 * ── WHY THESE ARE CONSTANTS AND NOT A LIVE FEED ─────────────────────────────
 * Same reasoning as VND_PER_USD in lib/orders.ts, which this file reuses rather
 * than restating so the two can never disagree.
 *
 * A live rate would be more accurate to the hour and worse in every other way:
 * an import screen that silently reprices when a feed moves, an outage that
 * blocks importing entirely, and a cost recorded against a rate nobody chose.
 * These are numbers you set, they are shown next to every converted price at
 * the moment of import, and the rate used is written into the product's cost
 * note — so a margin can still be explained six months later.
 *
 * They are also only a starting point: an import lands as a DRAFT with an
 * editable price, so the rate has to be roughly right, not exactly right.
 *
 * ── KEEPING THEM CURRENT ────────────────────────────────────────────────────
 * Override any of them with FX_RATES in .env, as a comma-separated list of
 * CODE:rate, where rate is what one unit is worth in USD:
 *
 *   FX_RATES=CNY:0.1385,EUR:1.09
 *
 * Anything not listed there falls back to the table below. Check them when a
 * margin starts looking wrong; a few percent either way is absorbed by the
 * markup, which is the point of having one.
 */

/** What one unit of each currency is worth in USD. */
const DEFAULT_RATES: Record<string, number> = {
  USD: 1,

  // The one that matters most here — nearly every supplier is a Chinese shop.
  CNY: 0.14,

  // Taken from the rate the shop already charges in, so the two cannot drift.
  VND: 1 / VND_PER_USD,

  // Asia
  JPY: 0.0065,
  KRW: 0.00073,
  HKD: 0.128,
  TWD: 0.031,
  SGD: 0.74,
  THB: 0.028,
  MYR: 0.22,
  IDR: 0.0000615,
  PHP: 0.017,
  INR: 0.012,

  // Europe
  EUR: 1.08,
  GBP: 1.27,
  CHF: 1.12,
  SEK: 0.095,
  NOK: 0.092,
  DKK: 0.145,
  PLN: 0.25,
  TRY: 0.029,
  RUB: 0.011,

  // The rest
  AUD: 0.65,
  CAD: 0.73,
  NZD: 0.6,
  AED: 0.272,
  ZAR: 0.054,
  BRL: 0.18,
  MXN: 0.049,
};

/**
 * FX_RATES from the environment, parsed leniently: a malformed entry is
 * skipped rather than taking the whole table down with it, because a typo in
 * one currency should not stop imports in every other.
 */
function overrides(): Record<string, number> {
  const raw = import.meta.env.FX_RATES;
  if (typeof raw !== 'string' || !raw.trim()) return {};

  const parsed: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [code, value] = pair.split(':');
    const rate = Number(value);
    if (!code?.trim() || !Number.isFinite(rate) || rate <= 0) continue;
    parsed[code.trim().toUpperCase().slice(0, 3)] = rate;
  }
  return parsed;
}

export const RATES: Record<string, number> = { ...DEFAULT_RATES, ...overrides() };

/** The currencies we can convert, for a dropdown or a lookup table. */
export const SUPPORTED = Object.keys(RATES).sort();

/** Whatever arrived, reduced to a currency code we might recognise. */
export function normaliseCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return code.length === 3 ? code : null;
}

/** What one unit of `code` is worth in USD, or null if we have no rate for it. */
export function rateFor(code: unknown): number | null {
  const normalised = normaliseCode(code);
  if (!normalised) return null;
  return RATES[normalised] ?? null;
}

export interface Converted {
  /** The amount in USD, rounded to the cent. */
  usd: number;
  /** What it was before, and in what. */
  sourceAmount: number;
  sourceCurrency: string;
  /** The rate applied, so it can be shown and recorded. */
  rate: number;
}

/**
 * Convert a supplier's price into USD.
 *
 * Returns null when there is nothing to do or nothing we can do — an amount
 * that is already USD, a currency we hold no rate for, or a missing price.
 * Null means "leave it alone", never "it is zero", which is why every caller
 * checks rather than defaulting.
 */
export function toUsd(amount: number | null | undefined, currency: unknown): Converted | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;

  const code = normaliseCode(currency);
  if (!code || code === 'USD') return null;

  const rate = RATES[code];
  if (!rate) return null;

  return {
    usd: Math.round(amount * rate * 100) / 100,
    sourceAmount: amount,
    sourceCurrency: code,
    rate,
  };
}

/** Symbols worth printing; everything else shows its three-letter code. */
const SYMBOLS: Record<string, string> = {
  USD: '$',
  CNY: '¥',
  JPY: '¥',
  EUR: '€',
  GBP: '£',
  KRW: '₩',
  VND: '₫',
  INR: '₹',
  THB: '฿',
  PHP: '₱',
};

/** "¥120.00" where we know the symbol, "120.00 SEK" where we do not. */
export function formatSource(amount: number, code: string): string {
  const symbol = SYMBOLS[code];
  const figure = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return symbol ? `${symbol}${figure}` : `${figure} ${code}`;
}

/**
 * The sentence that goes on the product's cost note, so the rate a margin was
 * set against survives on the row rather than living only in someone's memory.
 */
export function conversionNote(converted: Converted): string {
  return `Source price ${formatSource(converted.sourceAmount, converted.sourceCurrency)} converted at ${converted.rate} ${converted.sourceCurrency}/USD → $${converted.usd.toFixed(2)}.`;
}
