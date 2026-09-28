import { describe, expect, it } from 'vitest';
import { priceBundle, withResolvedItems } from '../src/lib/makes';
import { parseLines, priceCart } from '../src/lib/orders';
import type { Make, MakeItemWithProduct, Product } from '../src/lib/database.types';

/*
 * The shop sells kits — makes and bundles — and never a loose product. Every
 * item is in the kit; the ones marked can_opt_out can be left out by the
 * customer, which takes that item's share of the kit's price off.
 */

const product = (id: string, price: number, stock = 10): Product =>
  ({ id, name: id, slug: id, price, stock, cost_price: price / 2, is_active: true, images: [] }) as unknown as Product;

const item = (id: string, price: number, opts: { skip?: boolean; qty?: number; stock?: number } = {}) =>
  ({
    id: `item-${id}`,
    product_id: id,
    quantity: opts.qty ?? 1,
    note: null,
    can_opt_out: opts.skip ?? false,
    display_order: 0,
    product: product(id, price, opts.stock),
  }) as unknown as MakeItemWithProduct;

const kit = (overrides: Partial<Make> = {}) =>
  ({
    id: 'kit-1',
    kind: 'bundle',
    title: 'Bundle for beginners',
    slug: 'beginners',
    bundle_price: null,
    bundle_discount_pct: 20,
    image_url: null,
    is_active: true,
    ...overrides,
  }) as unknown as Make;

// Two yarns that are always in, a hook and scissors the customer may skip.
const items = [
  item('yarn-a', 10, { qty: 2 }),
  item('yarn-b', 10),
  item('hook', 5, { skip: true }),
  item('scissors', 5, { skip: true }),
];

describe('priceBundle', () => {
  it('prices the whole kit, skippable tools included, at the kit discount', () => {
    const pricing = priceBundle(kit(), items);
    // 20 + 10 + 5 + 5 = 40, less 20%.
    expect(pricing.itemsSubtotal).toBe(40);
    expect(pricing.bundlePrice).toBeCloseTo(32);
    expect(pricing.included).toHaveLength(4);
    expect(pricing.skippable.map((i) => i.product_id)).toEqual(['hook', 'scissors']);
  });

  it("takes a skipped tool's share off at the same discount", () => {
    const pricing = priceBundle(kit(), items, ['hook']);
    // The hook is $5 of a 20%-off kit, so it takes $4 off.
    expect(pricing.bundlePrice).toBeCloseTo(28);
    expect(pricing.optOutValue.hook).toBe(4);
    expect(pricing.omitted.map((i) => i.product_id)).toEqual(['hook']);
    expect(pricing.savingsPct).toBeCloseTo(20);
  });

  it('keeps a fixed kit price in proportion when a tool is skipped', () => {
    const pricing = priceBundle(kit({ bundle_price: 30 }), items, ['scissors']);
    // $30 for $40 of parts: the $5 scissors carry $3.75 of it.
    expect(pricing.bundlePrice).toBeCloseTo(26.25);
  });

  it('never leaves out an item that is not marked skippable', () => {
    const pricing = priceBundle(kit(), items, ['yarn-a', 'hook']);
    expect(pricing.omitted.map((i) => i.product_id)).toEqual(['hook']);
    expect(pricing.included.map((i) => i.product_id)).toContain('yarn-a');
  });
});

describe('rows from before the bundles migration', () => {
  it('reads is_optional as can_opt_out and treats a missing kind as a make', () => {
    const make = withResolvedItems({
      id: 'old',
      title: 'Old make',
      items: [{ product_id: 'hook', quantity: 1, is_optional: true, display_order: 1, product: product('hook', 5) }],
    });
    expect(make.kind).toBe('make');
    expect(make.items[0].can_opt_out).toBe(true);
  });
});

describe('parseLines', () => {
  it('keeps what was left out, sorted, and tells lines apart by it', () => {
    const lines = parseLines([
      { kind: 'bundle', id: 'kit-1', qty: 1, omit: ['scissors', 'hook'] },
      { kind: 'bundle', id: 'kit-1', qty: 1, omit: ['hook', 'scissors'] },
      { kind: 'bundle', id: 'kit-1', qty: 2 },
    ]);
    // The first two are the same line; the third is the kit with nothing left out.
    expect(lines).toHaveLength(2);
    expect(lines[0].omit).toEqual(['hook', 'scissors']);
    expect(lines[1].omit).toEqual([]);
  });
});

/** Just enough of the Supabase client for priceCart's one query. */
function fakeAdmin(rows: unknown[]) {
  const query = {
    select: () => query,
    in: () => query,
    eq: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => query } as never;
}

describe('priceCart', () => {
  const row = { ...kit(), items };

  it('turns away a loose product', async () => {
    const priced = await priceCart(fakeAdmin([]), parseLines([{ kind: 'product', id: 'yarn-a', qty: 1 }]));
    expect(priced.lines).toHaveLength(0);
    expect(priced.problems[0].message).toMatch(/no longer sold on their own/);
  });

  it('prices a kit without its hook, and does not take the hook off the shelf', async () => {
    const priced = await priceCart(fakeAdmin([row]), parseLines([{ kind: 'bundle', id: 'kit-1', qty: 1, omit: ['hook'] }]));
    expect(priced.problems).toEqual([]);
    expect(priced.lines[0].unitPrice).toBe(28);
    expect(priced.lines[0].omitted).toEqual(['hook']);
    expect(priced.lines[0].key).toBe('bundle:kit-1:hook');
    expect(priced.units.map((u) => u.product_id).sort()).toEqual(['scissors', 'yarn-a', 'yarn-b']);
  });

  it('lets a kit be bought without a sold-out tool, but not with it', async () => {
    const soldOutHook = { ...row, items: [...items.slice(0, 2), item('hook', 5, { skip: true, stock: 0 }), items[3]] };
    const withHook = await priceCart(fakeAdmin([soldOutHook]), parseLines([{ kind: 'bundle', id: 'kit-1', qty: 1 }]));
    expect(withHook.problems[0].reason).toBe('stock');

    const withoutHook = await priceCart(
      fakeAdmin([soldOutHook]),
      parseLines([{ kind: 'bundle', id: 'kit-1', qty: 1, omit: ['hook'] }]),
    );
    expect(withoutHook.problems).toEqual([]);
  });
});
