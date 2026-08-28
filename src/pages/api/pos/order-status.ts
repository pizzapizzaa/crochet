export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { bool, nullableStr, safeNext, str, withFlash } from '../../../lib/posForms';
import { applyStatus } from '../../../lib/fulfilment';
import { ORDER_STATUSES, type Order, type OrderStatus } from '../../../lib/database.types';

/*
 * Move an order along.
 *
 * This route used to check only that the submitted word was in the enum, which
 * let an unpaid order be marked delivered and a cancelled one walked back to
 * shipped. The rules now live in lib/fulfilment.ts and are shared with the bulk
 * bar and the sweep, so there is one answer to "can this order go there" rather
 * than one per caller.
 *
 * Carrier and tracking ride along with the move rather than living in a second
 * form: a parcel is given its consignment number at the moment it goes out.
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

  // Read before write: every rule below is about where this order is *now*.
  const { data } = await admin.from('orders').select('*').eq('id', id).maybeSingle();
  const order = data as Order | null;
  if (!order) return redirect(withFlash(back, 'error', 'That order no longer exists.'));

  const result = await applyStatus(admin, order, status, {
    carrier: nullableStr(form, 'carrier'),
    trackingNumber: nullableStr(form, 'tracking_number'),
    trackingUrl: nullableStr(form, 'tracking_url'),
    restock: bool(form, 'restock'),
    actor: 'staff',
  });

  return redirect(withFlash(back, result.ok ? 'ok' : 'error', result.message));
};
