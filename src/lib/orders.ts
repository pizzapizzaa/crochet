import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, MakeWithBundle, Order, Product } from './database.types';
import { priceBundle } from './makes';

/*
 * Where a basket turns into money.
 *
 * The browser sends nothing but { kind, id, qty }. Names, prices, stock and the
 * bundle discount are all read back out of the database here, every time — so a
 * hand-edited localStorage buys nothing it should not. Bundles are priced
 * through priceBundle(), the same function the make page and the POS quote
 * from, which is the only way those three can agree.
 */

type Admin = SupabaseClient<Database>;

/** Free over the threshold — the promise already printed on the product page. */
export const SHIPPING_FLAT = 8;
export const FREE_SHIPPING_OVER = 80;
export const CURRENCY = 'USD';

/*
 * The catalogue is priced in USD but payOS settles in VND, so the total is
 * converted at the moment of payment. This rate is a business decision, not a
 * live market feed: it is deliberately a constant you set, so a customer is
 * never quoted one number and charged another because a rate moved mid-basket.
 *
 * Override with VND_PER_USD in .env. Revisit it when the rate drifts enough to
 * matter — a few percent either way is the margin you are absorbing.
 */
export const VND_PER_USD = Number(import.meta.env.VND_PER_USD ?? 26_000);

/** VND has no minor unit, and payOS takes whole dong only. */
export const usdToVnd = (usd: number) => Math.round(usd * VND_PER_USD);

export interface RequestedLine {
  kind: 'product' | 'bundle';
  id: string;
  qty: number;
}

/** A line as the customer will see it on the order — priced, named, fixed. */
export interface PricedLine {
  kind: 'product' | 'bundle';
  id: string;
  name: string;
  slug: string;
  href: string;
  image: string | null;
  /** Price for one of this line. A bundle's is the discounted whole. */
  unitPrice: number;
  qty: number;
  lineTotal: number;
  /** For a bundle, what the parts would have cost bought separately. */
  compareAt: number | null;
}

/** One product and how many of it this basket draws off the shelf. */
export interface Unit {
  product_id: string;
  quantity: number;
}

export interface Problem {
  id: string;
  name: string;
  /** `gone` covers deleted and unpublished alike — from outside they look the same. */
  reason: 'gone' | 'stock';
  message: string;
}

export interface PricedCart {
  lines: PricedLine[];
  units: Unit[];
  subtotal: number;
  shipping: number;
  total: number;
  problems: Problem[];
}

const money = (n: number) => Math.round(n * 100) / 100;

/** Anything that is not a positive whole number of things is one thing. */
function cleanQty(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(99, Math.floor(n));
}

/** Accepts whatever arrived over the wire and keeps only what looks like a line. */
export function parseLines(input: unknown): RequestedLine[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const lines: RequestedLine[] = [];

  for (const raw of input.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const { kind, id, qty } = raw as Record<string, unknown>;
    if (kind !== 'product' && kind !== 'bundle') continue;
    if (typeof id !== 'string' || !id) continue;

    // A repeated line would otherwise be priced twice.
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    lines.push({ kind, id, qty: cleanQty(qty) });
  }

  return lines;
}

export const shippingFor = (subtotal: number) =>
  subtotal <= 0 || subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FLAT;

/**
 * Price a basket against the live catalogue.
 *
 * Lines that no longer exist are dropped and reported rather than silently
 * skipped, so the cart can say "this sold out" instead of just quietly costing
 * less than it did a moment ago.
 */
export async function priceCart(admin: Admin, requested: RequestedLine[]): Promise<PricedCart> {
  const productIds = requested.filter((l) => l.kind === 'product').map((l) => l.id);
  const makeIds = requested.filter((l) => l.kind === 'bundle').map((l) => l.id);

  const [productRes, makeRes] = await Promise.all([
    productIds.length
      ? admin.from('products').select('*').in('id', productIds).eq('is_active', true)
      : Promise.resolve({ data: [] as Product[] }),
    makeIds.length
      ? admin
          .from('makes')
          .select('*, items:make_items(*, product:products(*))')
          .in('id', makeIds)
          .eq('is_active', true)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const products = new Map(((productRes.data ?? []) as Product[]).map((p) => [p.id, p]));
  const makes = new Map(
    ((makeRes.data ?? []) as unknown as MakeWithBundle[]).map((m) => [m.id, m]),
  );

  const lines: PricedLine[] = [];
  const problems: Problem[] = [];
  // A product can be both a loose line and part of a bundle, so demand is
  // totalled per product before it is checked against the shelf.
  const demand = new Map<string, number>();

  for (const line of requested) {
    if (line.kind === 'product') {
      const product = products.get(line.id);
      if (!product) {
        problems.push({
          id: line.id,
          name: 'An item',
          reason: 'gone',
          message: 'This item is no longer in the shop, so it has been taken out of your basket.',
        });
        continue;
      }

      const unitPrice = money(Number(product.price));
      lines.push({
        kind: 'product',
        id: product.id,
        name: product.name,
        slug: product.slug,
        href: `/store/${product.slug}`,
        image: product.images?.[0] ?? null,
        unitPrice,
        qty: line.qty,
        lineTotal: money(unitPrice * line.qty),
        compareAt: product.compare_at_price ? money(Number(product.compare_at_price)) : null,
      });

      demand.set(product.id, (demand.get(product.id) ?? 0) + line.qty);
      continue;
    }

    const make = makes.get(line.id);
    if (!make) {
      problems.push({
        id: line.id,
        name: 'A bundle',
        reason: 'gone',
        message: 'This bundle is no longer available, so it has been taken out of your basket.',
      });
      continue;
    }

    const pricing = priceBundle(make, make.items);
    if (pricing.required.length === 0) {
      problems.push({
        id: line.id,
        name: make.title,
        reason: 'gone',
        message: `“${make.title}” has no materials listed yet, so it cannot be bought.`,
      });
      continue;
    }

    const unitPrice = money(pricing.bundlePrice);
    lines.push({
      kind: 'bundle',
      id: make.id,
      name: `${make.title} — the whole bundle`,
      slug: make.slug,
      href: `/makes/${make.slug}`,
      image: make.image_url,
      unitPrice,
      qty: line.qty,
      lineTotal: money(unitPrice * line.qty),
      compareAt: pricing.savings > 0 ? money(pricing.itemsSubtotal) : null,
    });

    for (const item of pricing.required) {
      const wanted = Number(item.quantity) * line.qty;
      demand.set(item.product_id, (demand.get(item.product_id) ?? 0) + wanted);
    }
  }

  // Stock is checked once per product against the total demand, so two lines
  // that each fit but together do not are caught.
  const units: Unit[] = [];
  for (const [productId, quantity] of demand) {
    const rounded = Math.ceil(quantity);
    units.push({ product_id: productId, quantity: rounded });

    const product = products.get(productId) ?? findInBundles(makes, productId);
    if (product && product.stock < rounded) {
      problems.push({
        id: productId,
        name: product.name,
        reason: 'stock',
        message:
          product.stock === 0
            ? `“${product.name}” has sold out.`
            : `Only ${product.stock} of “${product.name}” left — your basket needs ${rounded}.`,
      });
    }
  }

  const subtotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const shipping = shippingFor(subtotal);

  return { lines, units, subtotal, shipping, total: money(subtotal + shipping), problems };
}

/** A bundle's components are only loaded through the make, not the product map. */
function findInBundles(makes: Map<string, MakeWithBundle>, productId: string): Product | null {
  for (const make of makes.values()) {
    const item = make.items.find((i) => i.product_id === productId);
    if (item) return item.product;
  }
  return null;
}

/*
 * Order numbers.
 *
 * Deliberately not sequential: an order number goes in an email and gets read
 * out over the phone, and a guessable one would let anyone with a customer's
 * address walk the catalogue of everything else that has been sold. The
 * alphabet drops the characters people misread aloud — no O/0, no I/1/L.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function orderNumber(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `ZZ-${code}`;
}

/**
 * An order number on its own is not a credential — it is printed on packing
 * slips and forwarded in emails. Pairing it with the address the order was
 * placed under is what makes a lookup safe, so the two always travel together.
 */
export async function findOrder(
  admin: Admin,
  number: string,
  email: string,
): Promise<Order | null> {
  const trimmed = number.trim().toUpperCase();
  const address = email.trim().toLowerCase();
  if (!trimmed || !address) return null;

  const { data } = await admin
    .from('orders')
    .select('*')
    .eq('order_number', trimmed)
    .ilike('customer_email', address)
    .maybeSingle();

  return (data as Order) ?? null;
}

/** The snapshot stored on the order row. See the column comment in shop-schema.sql. */
export interface OrderItems {
  lines: PricedLine[];
  units: Unit[];
}

export function orderItems(order: Order): OrderItems {
  const raw = order.items as unknown as Partial<OrderItems> | null;
  return { lines: raw?.lines ?? [], units: raw?.units ?? [] };
}

export interface ShippingAddress {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
}

export function shippingAddress(order: Order): ShippingAddress {
  const raw = (order.shipping_address ?? {}) as Partial<ShippingAddress>;
  return {
    line1: raw.line1 ?? '',
    line2: raw.line2 ?? '',
    city: raw.city ?? '',
    region: raw.region ?? '',
    postcode: raw.postcode ?? '',
    country: raw.country ?? '',
  };
}

export type SettleResult = 'paid' | 'needs-attention';

/*
 * Turn a confirmed payment into a paid order. Provider-agnostic on purpose:
 * whatever takes the money hands over an order id and a reference, and the
 * rest is the same work every time.
 *
 * Two callers race this by design — the provider's webhook and the customer
 * landing back on the receipt. The webhook is the one that must always work,
 * since it fires whether or not the browser survives the round trip; the page
 * calls it too so nobody watches "awaiting payment" on something they just
 * paid for. commit_order is idempotent, so whichever arrives first wins.
 */
export async function settleOrder(
  admin: Admin,
  orderId: string,
  reference: string | null,
): Promise<SettleResult> {
  const { error } = await admin.rpc('commit_order', {
    p_order_id: orderId,
    p_payment_ref: reference ?? '',
  });

  if (!error) return 'paid';

  /*
   * Money in, stock not moved — someone bought the last one while this customer
   * was scanning the QR code. The payment is real and must not be denied, so
   * the order is flagged for a human instead: it shows as paid in the POS with
   * a note, and gets refunded or restocked by hand.
   */
  console.error('commit_order failed', orderId, error.message);

  const { data } = await admin
    .from('orders')
    .select('customer_note')
    .eq('id', orderId)
    .maybeSingle();

  await admin
    .from('orders')
    .update({
      payment_status: 'paid',
      payment_reference: reference,
      paid_at: new Date().toISOString(),
      // Appended, never replaced — the customer's own note still matters.
      customer_note: [data?.customer_note, `⚠ Stock not adjusted: ${error.message}`]
        .filter(Boolean)
        .join('\n'),
    })
    .eq('id', orderId);

  return 'needs-attention';
}

/** One line per row, blanks dropped — for printing on a label or a POS card. */
export function formatAddress(address: ShippingAddress): string[] {
  return [
    address.line1,
    address.line2,
    [address.city, address.region].filter(Boolean).join(', '),
    address.postcode,
    address.country,
  ].filter(Boolean);
}
