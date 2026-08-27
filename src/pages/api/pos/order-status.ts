export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { safeNext, str, withFlash } from '../../../lib/posForms';
import { ORDER_STATUSES, type OrderStatus } from '../../../lib/database.types';

/*
 * Move an order along. This is the one field the shop owner edits by hand —
 * everything else on an order is a record of what happened and stays put.
 *
 * Note this does not touch stock. Cancelling an order does not put the yarn
 * back on the shelf, because by then it may well have been wound: restocking
 * is a decision, made in the product editor, not a side effect of a dropdown.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const status = str(form, 'status') as OrderStatus;
  const back = safeNext(form, '/pos/orders');

  const admin = getSupabaseAdmin();
  if (!admin) return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  if (!id) return redirect(withFlash(back, 'error', 'No order was named.'));
  if (!ORDER_STATUSES.includes(status)) {
    return redirect(withFlash(back, 'error', 'That is not a status an order can be in.'));
  }

  const { error } = await admin.from('orders').update({ status }).eq('id', id);
  if (error) {
    return redirect(withFlash(back, 'error', `Could not update: ${error.message}`));
  }

  return redirect(withFlash(back, 'ok', `Marked as ${status}.`));
};
