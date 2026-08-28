export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { bool, nullableStr, safeNext, str, withFlash } from '../../../lib/posForms';
import { logEvent } from '../../../lib/fulfilment';
import type { Order } from '../../../lib/database.types';

/*
 * Write down that a refund happened.
 *
 * No money moves here, and that is not a shortcoming — payOS does not reverse a
 * VietQR transfer, so the refund is a bank transfer the shop owner makes by
 * hand in a banking app. What was missing was any way to record it: the
 * `refunded` payment status existed in the schema and nothing in the POS could
 * ever set it, so the only honest way to mark a refunded order was to open the
 * Supabase table editor.
 *
 * The reference field is the transfer's own reference, which is what makes this
 * row checkable against a bank statement months later. It is optional, because
 * a refund that happened is worth recording even if nobody has the reference to
 * hand yet.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const reference = nullableStr(form, 'reference');
  const restock = bool(form, 'restock');
  const back = safeNext(form, '/pos/orders');

  const admin = getSupabaseAdmin();
  if (!admin) return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  if (!id) return redirect(withFlash(back, 'error', 'No order was named.'));

  const { data } = await admin.from('orders').select('*').eq('id', id).maybeSingle();
  const order = data as Order | null;
  if (!order) return redirect(withFlash(back, 'error', 'That order no longer exists.'));

  if (order.payment_status === 'refunded') {
    return redirect(withFlash(back, 'error', 'That order is already marked refunded.'));
  }
  if (order.payment_status !== 'paid') {
    return redirect(
      withFlash(back, 'error', `Nothing was taken for this order — it is ${order.payment_status}.`),
    );
  }

  const { error } = await admin
    .from('orders')
    .update({
      payment_status: 'refunded',
      refunded_at: new Date().toISOString(),
      refund_reference: reference,
      // A refunded order is settled, whatever went wrong with it before.
      needs_attention: false,
      attention_reason: null,
    })
    .eq('id', order.id);

  if (error) {
    return redirect(withFlash(back, 'error', `Could not record that: ${error.message}`));
  }

  await logEvent(admin, {
    orderId: order.id,
    kind: 'payment',
    message: reference ? `Refunded by bank transfer (${reference}).` : 'Refunded by bank transfer.',
    actor: 'staff',
  });

  /*
   * Restocking is offered rather than assumed, and only bites when the stock
   * was actually drawn. A refund on an order whose commit failed has no stock
   * to give back — it never took any — and restock_order refuses that case
   * outright rather than inventing yarn.
   */
  if (restock && order.stock_committed) {
    const { error: restockError } = await admin.rpc('restock_order', { p_order_id: order.id });
    if (restockError) {
      return redirect(
        withFlash(back, 'error', `Refund recorded, but the restock failed: ${restockError.message}`),
      );
    }
    await logEvent(admin, {
      orderId: order.id,
      kind: 'stock',
      message: 'Stock put back on the shelf after the refund.',
      actor: 'staff',
    });
    return redirect(withFlash(back, 'ok', 'Refund recorded and the stock is back on the shelf.'));
  }

  return redirect(withFlash(back, 'ok', 'Refund recorded.'));
};
