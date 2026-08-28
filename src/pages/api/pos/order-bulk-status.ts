export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { all, safeNext, str, withFlash } from '../../../lib/posForms';
import { applyStatus } from '../../../lib/fulfilment';
import { ORDER_STATUSES, type Order, type OrderStatus } from '../../../lib/database.types';

/*
 * Move a screenful of orders at once.
 *
 * The whole point of a packing session is that twelve parcels go out together,
 * and opening twelve tabs to say so is the kind of friction that ends with the
 * status field being abandoned as a fiction.
 *
 * Each order is still put through applyStatus one at a time rather than being
 * swept into a single UPDATE, because the rules are per-order: in a batch of
 * twelve, the one that is still unpaid has to be refused while the other eleven
 * go. A partial result reported honestly beats an all-or-nothing that fails on
 * the whole batch because of one row.
 */
const MAX_BATCH = 100;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const ids = [...new Set(all(form, 'ids'))].filter(Boolean).slice(0, MAX_BATCH);
  const status = str(form, 'status') as OrderStatus;
  const back = safeNext(form, '/pos/orders');

  const admin = getSupabaseAdmin();
  if (!admin) return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  if (ids.length === 0) return redirect(withFlash(back, 'error', 'No orders were ticked.'));
  if (!ORDER_STATUSES.includes(status)) {
    return redirect(withFlash(back, 'error', 'That is not a status an order can be in.'));
  }

  const { data, error } = await admin.from('orders').select('*').in('id', ids);
  if (error) {
    return redirect(withFlash(back, 'error', `Could not read those orders: ${error.message}`));
  }

  const orders = (data ?? []) as Order[];

  /*
   * Sequential on purpose. These are writes against rows the shop owner is
   * looking at, and a hundred concurrent updates through one service-role
   * connection buys nothing on a batch this size.
   */
  let moved = 0;
  const refused: string[] = [];

  for (const order of orders) {
    const result = await applyStatus(admin, order, status, { actor: 'staff' });
    if (result.ok) moved += 1;
    else refused.push(`${order.order_number} (${result.message})`);
  }

  if (moved === 0) {
    return redirect(
      withFlash(back, 'error', `Nothing moved. ${refused.slice(0, 3).join(' · ')}`),
    );
  }

  const summary = `Moved ${moved} order${moved === 1 ? '' : 's'} to ${status}.`;

  if (refused.length === 0) return redirect(withFlash(back, 'ok', summary));

  // The refusals are the interesting half — say which, not just how many.
  return redirect(
    withFlash(
      back,
      'error',
      `${summary} ${refused.length} left alone: ${refused.slice(0, 3).join(' · ')}${
        refused.length > 3 ? ` and ${refused.length - 3} more` : ''
      }`,
    ),
  );
};
