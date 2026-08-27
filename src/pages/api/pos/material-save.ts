export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { nullableNum, nullableStr, num, safeNext, str, withFlash } from '../../../lib/posForms';
import type { Database } from '../../../lib/database.types';

/*
 * The cost side of a product, saved from one row of /pos/materials.
 *
 * Deliberately narrow: it writes what a material costs, where it comes from
 * and what it sells for, and nothing else. The full editor at
 * /pos/products/[id] owns everything to do with how the product is presented.
 */
type ProductUpdate = Database['public']['Tables']['products']['Update'];

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const back = safeNext(form, '/pos/materials');

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  }
  if (!id) {
    return redirect(withFlash(back, 'error', 'No material was named.'));
  }

  const cost = nullableNum(form, 'cost_price');
  if (cost !== null && cost < 0) {
    return redirect(withFlash(back, 'error', 'Cost cannot be negative.'));
  }

  const price = num(form, 'price', NaN);
  if (!Number.isFinite(price) || price < 0) {
    return redirect(withFlash(back, 'error', 'Sell price must be a number of zero or more.'));
  }

  const unitsSold = Math.max(0, Math.round(num(form, 'units_sold', 0)));

  const payload: ProductUpdate = {
    cost_price: cost,
    price,
    units_sold: unitsSold,
    supplier_name: nullableStr(form, 'supplier_name'),
    supplier_url: nullableStr(form, 'supplier_url'),
    supplier_sku: nullableStr(form, 'supplier_sku'),
    cost_note: nullableStr(form, 'cost_note'),
  };

  const { data, error } = await admin
    .from('products')
    .update(payload)
    .eq('id', id)
    .select('name')
    .maybeSingle();

  if (error) {
    return redirect(withFlash(back, 'error', `Could not save: ${error.message}`));
  }

  // Say the margin back so the number is confirmed without hunting for the row.
  const margin =
    cost !== null && price > 0 ? ` Margin is now ${(((price - cost) / price) * 100).toFixed(1)}%.` : '';
  const warning = cost !== null && price <= cost ? ' That sells at or below cost.' : '';

  return redirect(
    withFlash(back, 'ok', `Saved ${data?.name ? `“${data.name}”` : 'the material'}.${margin}${warning}`),
  );
};
