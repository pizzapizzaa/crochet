import { supabase, isSupabaseConfigured } from './supabase';
import type {
  Difficulty,
  Make,
  MakeItemWithProduct,
  MakeKind,
  MakeWithBundle,
  Product,
} from './database.types';

/*
 * What the shop sells: kits, never a loose roll of yarn. There are two kinds,
 * held in the same table and sold the same way:
 *
 *   make    a kit inspired by somebody else's Pinterest pin or design. We never
 *           sell the finished object and never rehost the pattern — the pin
 *           stays the destination, which is why the author fields travel with
 *           every make we read.
 *   bundle  a kit the shop put together itself, around a skill level —
 *           "Bundle for beginners". Nobody to credit.
 *
 * Every item in a kit is in the box. The ones marked can_opt_out — a hook,
 * scissors, a needle — are the tools somebody may already own, and the
 * customer can leave them out, which takes their share off the price.
 *
 * There is no mock fallback. Products degrade to a mock catalogue so the shop
 * still lays out before Supabase is wired up, but a make is a real citation of
 * a real person's pin; inventing one would put a fabricated credit on the page.
 * With no database the makes pages simply say there is nothing here yet.
 */

/** Rows are selected with the bundle nested one level deep. */
const SELECT_WITH_ITEMS = '*, items:make_items(*, product:products(*))';

export interface BundlePricing {
  /** Every item in the kit, in display order. */
  items: MakeItemWithProduct[];
  /** The items going in the box: everything, less what the customer left out. */
  included: MakeItemWithProduct[];
  /** What the customer chose to leave out. */
  omitted: MakeItemWithProduct[];
  /** What the customer may leave out. */
  skippable: MakeItemWithProduct[];
  /** The included items at today's price, added up. */
  itemsSubtotal: number;
  /** What we charge: the kit's price, less the share of anything left out. */
  bundlePrice: number;
  /** itemsSubtotal - bundlePrice, floored at zero. */
  savings: number;
  savingsPct: number;
  /** What the whole kit sells for with nothing left out. */
  fullPrice: number;
  /** What leaving out each skippable item takes off the price, by product id. */
  optOutValue: Record<string, number>;
  /** What the included materials cost us. Null when any of them has no cost on file. */
  itemsCost: number | null;
}

export function lineTotal(item: MakeItemWithProduct): number {
  return Number(item.product.price) * Number(item.quantity);
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * One place where a kit turns into money, used by the shop, the make page, the
 * basket and the POS preview alike so they can never quote different numbers.
 *
 * `omit` is the product ids the customer wants left out. Only items marked
 * can_opt_out are ever left out, whatever arrives — a hand-edited basket
 * cannot talk its way out of paying for the yarn.
 *
 * Leaving an item out takes off its share of the kit's price, not its full
 * price: a kit sold at 15% off drops a $4 hook's $3.40, so the discount the
 * page advertises holds for whatever the customer keeps.
 */
export function priceBundle(
  make: Make,
  items: MakeItemWithProduct[],
  omit: Iterable<string> = [],
): BundlePricing {
  const ordered = [...items].sort((a, b) => a.display_order - b.display_order);
  const skippable = ordered.filter((i) => i.can_opt_out);
  const leaveOut = new Set(omit);
  const omitted = skippable.filter((i) => leaveOut.has(i.product_id));
  const included = ordered.filter((i) => !omitted.includes(i));

  const fullSubtotal = ordered.reduce((sum, i) => sum + lineTotal(i), 0);
  const itemsSubtotal = included.reduce((sum, i) => sum + lineTotal(i), 0);

  // An explicit bundle_price wins; otherwise the discount comes off the sum.
  const discounted = fullSubtotal * (1 - Number(make.bundle_discount_pct ?? 0) / 100);
  const fullPrice =
    make.bundle_price !== null && make.bundle_price !== undefined ? Number(make.bundle_price) : discounted;

  // The kit's price as a fraction of its parts, applied to whatever stays in.
  const ratio = fullSubtotal > 0 ? fullPrice / fullSubtotal : 0;
  const bundlePrice = ratio * itemsSubtotal;
  const savings = Math.max(0, itemsSubtotal - bundlePrice);

  const optOutValue = Object.fromEntries(skippable.map((i) => [i.product_id, cents(ratio * lineTotal(i))]));

  // A partial cost is worse than none: it would understate what the kit
  // costs us and quietly overstate the margin on /pos/materials.
  const missingCost = included.some((i) => i.product.cost_price === null || i.product.cost_price === undefined);
  const itemsCost = missingCost
    ? null
    : included.reduce((sum, i) => sum + Number(i.product.cost_price) * Number(i.quantity), 0);

  return {
    items: ordered,
    included,
    omitted,
    skippable,
    itemsSubtotal,
    bundlePrice,
    savings,
    savingsPct: itemsSubtotal > 0 ? (savings / itemsSubtotal) * 100 : 0,
    fullPrice,
    optOutValue,
    itemsCost,
  };
}

/*
 * Rows read before supabase/bundles-schema.sql has been run have no `kind`
 * and still call can_opt_out `is_optional`. Reading both keeps the shop up in
 * the gap between deploying this and running the migration.
 */
export function normaliseMake<T extends Record<string, unknown>>(row: T): T & { kind: MakeKind } {
  const kind = row.kind === 'bundle' ? 'bundle' : 'make';
  return { ...row, kind };
}

function normaliseItem(item: Record<string, unknown>): Record<string, unknown> {
  return { ...item, can_opt_out: Boolean(item.can_opt_out ?? item.is_optional ?? false) };
}

/**
 * Drop lines whose product came back null. Under the public anon key that
 * means the product was unpublished — showing a line we cannot price, or
 * pricing the bundle as if it were free, would both be worse than omitting it.
 */
export function withResolvedItems(row: Record<string, unknown>): MakeWithBundle {
  const raw = (row.items ?? []) as Array<Record<string, unknown> & { product: Product | null }>;
  const items = raw
    .filter((i) => i.product !== null)
    .map((i) => normaliseItem(i) as unknown as MakeItemWithProduct)
    .sort((a, b) => a.display_order - b.display_order);
  return { ...(normaliseMake(row) as unknown as Make), items };
}

/** Where a make or bundle lives on the site. */
export const kitHref = (make: Pick<Make, 'kind' | 'slug'>) =>
  `${make.kind === 'bundle' ? '/bundles' : '/makes'}/${make.slug}`;

/*
 * Kind is filtered here rather than in the query so these keep working before
 * the column exists; the catalogue is small enough that it costs nothing.
 */
async function getKits(kind: MakeKind): Promise<MakeWithBundle[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from('makes')
    .select(SELECT_WITH_ITEMS)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(withResolvedItems).filter((m) => m.kind === kind);
}

/** Live makes with their kits, in display order. */
export const getMakes = () => getKits('make');

/** Live bundles, in display order. */
export const getBundles = () => getKits('bundle');

/** One live make or bundle by slug, items attached, or null. */
export async function getMakeBySlug(slug: string, kind: MakeKind = 'make'): Promise<MakeWithBundle | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from('makes')
    .select(SELECT_WITH_ITEMS)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  const make = withResolvedItems(data as unknown as Record<string, unknown>);
  return make.kind === kind ? make : null;
}

/** Makes and bundles that use a given product, for the "comes in" list on a product page. */
export async function getMakesUsingProduct(productId: string): Promise<Make[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from('make_items')
    .select('make:makes(*)')
    .eq('product_id', productId);

  if (error || !data) return [];
  return (data as unknown as { make: Record<string, unknown> | null }[])
    .map((r) => (r.make ? (normaliseMake(r.make) as unknown as Make) : null))
    .filter((m): m is Make => Boolean(m) && m!.is_active);
}

export const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2" not "2.00", but "1.5" stays "1.5" — quantities are counts, mostly. */
export const qty = (n: number) => {
  const value = Number(n);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
};

/*
 * Difficulty badge colours. A ramp, not four arbitrary hues: the fill warms and
 * darkens as the project gets harder, so the four tags read as a scale at a
 * glance rather than as decoration. Fills only from the brand palette, and the
 * label follows the fill rule — bright fill takes forest ink, the dark forest
 * fill takes cream.
 */
const DIFFICULTY_BADGE: Record<Difficulty, string> = {
  Beginner: 'bg-mint-soft text-ink',
  Easy: 'bg-mint text-ink',
  Intermediate: 'bg-lemon text-ink',
  Advanced: 'bg-forest text-paper',
};

/** Fill + label classes for a difficulty tag. Unknown values fall back to lemon. */
export const difficultyBadge = (difficulty: string | null | undefined) =>
  DIFFICULTY_BADGE[difficulty as Difficulty] ?? 'bg-lemon text-ink';
