import { supabase, isSupabaseConfigured } from './supabase';
import type { Make, MakeItemWithProduct, MakeWithBundle, Product } from './database.types';

/*
 * Makes: a project someone else published on Pinterest, plus the bundle of
 * yarn and tools we sell to recreate it. We never sell the finished object and
 * we never rehost the pattern — the pin stays the destination, which is why
 * every read here keeps the author fields attached to the row.
 *
 * There is no mock fallback. Products degrade to a mock catalogue so the shop
 * still lays out before Supabase is wired up, but a make is a real citation of
 * a real person's pin; inventing one would put a fabricated credit on the page.
 * With no database the makes pages simply say there is nothing here yet.
 */

/** Rows are selected with the bundle nested one level deep. */
const SELECT_WITH_ITEMS = '*, items:make_items(*, product:products(*))';

export interface BundlePricing {
  /** Every required line at today's price, added up. */
  itemsSubtotal: number;
  /** What we charge for the bundle: the explicit price, or the discounted subtotal. */
  bundlePrice: number;
  /** itemsSubtotal - bundlePrice, floored at zero. */
  savings: number;
  savingsPct: number;
  optionalSubtotal: number;
  /** What the required materials cost us. Null when any of them has no cost on file. */
  itemsCost: number | null;
  required: MakeItemWithProduct[];
  optional: MakeItemWithProduct[];
}

export function lineTotal(item: MakeItemWithProduct): number {
  return Number(item.product.price) * Number(item.quantity);
}

/**
 * One place where a bundle turns into money, used by the shop, the make page
 * and the POS preview alike so the three can never quote different numbers.
 */
export function priceBundle(make: Make, items: MakeItemWithProduct[]): BundlePricing {
  const ordered = [...items].sort((a, b) => a.display_order - b.display_order);
  const required = ordered.filter((i) => !i.is_optional);
  const optional = ordered.filter((i) => i.is_optional);

  const itemsSubtotal = required.reduce((sum, i) => sum + lineTotal(i), 0);
  const optionalSubtotal = optional.reduce((sum, i) => sum + lineTotal(i), 0);

  // An explicit bundle_price wins; otherwise the discount comes off the sum.
  // Clamped to the subtotal so a stale override can never invent a "saving".
  const discounted = itemsSubtotal * (1 - Number(make.bundle_discount_pct ?? 0) / 100);
  const bundlePrice =
    make.bundle_price !== null && make.bundle_price !== undefined
      ? Number(make.bundle_price)
      : discounted;

  const savings = Math.max(0, itemsSubtotal - bundlePrice);

  // A partial cost is worse than none: it would understate what the bundle
  // costs us and quietly overstate the margin on /pos/materials.
  const missingCost = required.some(
    (i) => i.product.cost_price === null || i.product.cost_price === undefined,
  );
  const itemsCost = missingCost
    ? null
    : required.reduce((sum, i) => sum + Number(i.product.cost_price) * Number(i.quantity), 0);

  return {
    itemsSubtotal,
    bundlePrice,
    savings,
    savingsPct: itemsSubtotal > 0 ? (savings / itemsSubtotal) * 100 : 0,
    optionalSubtotal,
    itemsCost,
    required,
    optional,
  };
}

/**
 * Drop lines whose product came back null. Under the public anon key that
 * means the product was unpublished — showing a line we cannot price, or
 * pricing the bundle as if it were free, would both be worse than omitting it.
 */
function withResolvedItems(row: Record<string, unknown>): MakeWithBundle {
  const raw = (row.items ?? []) as Array<Record<string, unknown> & { product: Product | null }>;
  const items = raw
    .filter((i) => i.product !== null)
    .map((i) => i as unknown as MakeItemWithProduct)
    .sort((a, b) => a.display_order - b.display_order);
  return { ...(row as unknown as Make), items };
}

/** Live makes with their bundles, in display order. */
export async function getMakes(): Promise<MakeWithBundle[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from('makes')
    .select(SELECT_WITH_ITEMS)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(withResolvedItems);
}

/** One live make by slug, bundle attached, or null. */
export async function getMakeBySlug(slug: string): Promise<MakeWithBundle | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from('makes')
    .select(SELECT_WITH_ITEMS)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return withResolvedItems(data as unknown as Record<string, unknown>);
}

/** Makes that use a given product, for the "also used in" note on a product page. */
export async function getMakesUsingProduct(productId: string): Promise<Make[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from('make_items')
    .select('make:makes(*)')
    .eq('product_id', productId);

  if (error || !data) return [];
  return (data as unknown as { make: Make | null }[])
    .map((r) => r.make)
    .filter((m): m is Make => Boolean(m) && m!.is_active);
}

export const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2" not "2.00", but "1.5" stays "1.5" — quantities are counts, mostly. */
export const qty = (n: number) => {
  const value = Number(n);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
};
