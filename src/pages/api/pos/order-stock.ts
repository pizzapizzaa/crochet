export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { safeNext, str, withFlash } from '../../../lib/posForms';
import { logEvent } from '../../../lib/fulfilment';
import type { Order } from '../../../lib/database.types';

/*
 * Move an order's stock by hand, both ways.
 *
 * This is the tooling the "needs a human" banner used to point at and not
 * provide. An order whose payment landed but whose commit rolled back is paid
 * for and holds no stock; once the shelf is filled again, `draw` finishes the
 * job that failed. `restock` is the reverse, for an order that was cancelled or
 * came back.
 *
 * Both are guarded by stock_committed rather than by payment status, because
 * that column is the only honest answer to "does this order currently hold
 * stock?" — and doing either twice is the way to silently corrupt a shelf count.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const action = str(form, 'action');
  const back = safeNext(form, '/pos/orders');

  const admin = getSupabaseAdmin();
  if (!admin) return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  if (!id) return redirect(withFlash(back, 'error', 'No order was named.'));
  if (action !== 'draw' && action !== 'restock') {
    return redirect(withFlash(back, 'error', 'That is not something to do to stock.'));
  }

  const { data } = await admin.from('orders').select('*').eq('id', id).maybeSingle();
  const order = data as Order | null;
  if (!order) return redirect(withFlash(back, 'error', 'That order no longer exists.'));

  if (action === 'draw') {
    if (order.stock_committed) {
      return redirect(
        withFlash(back, 'error', 'This order already holds its stock — drawing again would double it.'),
      );
    }

    const { error } = await admin.rpc('draw_order_stock', { p_order_id: order.id });
    if (error) {
      // Almost always still short. Say so plainly; the shelf is the fix.
      return redirect(
        withFlash(back, 'error', `Still not enough on the shelf: ${error.message}`),
      );
    }

    await logEvent(admin, {
      orderId: order.id,
      kind: 'stock',
      message: 'Stock drawn down by hand after the payment-time failure.',
      actor: 'staff',
    });

    // Drawing the stock is exactly what the order was flagged for. Clearing
    // the flag here is what stops the banner outliving the problem.
    await admin
      .from('orders')
      .update({ needs_attention: false, attention_reason: null })
      .eq('id', order.id);

    return redirect(withFlash(back, 'ok', 'Stock drawn down — this order is straight now.'));
  }

  if (!order.stock_committed) {
    return redirect(
      withFlash(back, 'error', 'This order holds no stock, so there is nothing to put back.'),
    );
  }

  const { error } = await admin.rpc('restock_order', { p_order_id: order.id });
  if (error) {
    return redirect(withFlash(back, 'error', `Could not restock: ${error.message}`));
  }

  await logEvent(admin, {
    orderId: order.id,
    kind: 'stock',
    message: 'Stock put back on the shelf by hand.',
    actor: 'staff',
  });

  return redirect(withFlash(back, 'ok', 'Stock is back on the shelf.'));
};
