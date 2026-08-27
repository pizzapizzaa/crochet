export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { settleOrder } from '../../../lib/orders';
import { getPayOS } from '../../../lib/payos';
import type { Order } from '../../../lib/database.types';

/*
 * payOS calls this the moment a transfer lands.
 *
 * This is the authoritative settlement path: it fires whether or not the
 * customer's browser survived the trip back from the QR screen, which the
 * receipt page cannot promise. The receipt page settles too, and the two race
 * on purpose — commit_order is idempotent, so whichever arrives first wins.
 *
 * Register the URL once from the payOS dashboard (or the SDK's
 * webhooks.confirm) as https://<your-domain>/api/shop/payos-webhook.
 */
export const POST: APIRoute = async ({ request }) => {
  const payos = getPayOS();
  if (!payos) return json({ error: 'payOS is not configured.' }, 503);

  const admin = getSupabaseAdmin();
  if (!admin) return json({ error: 'Supabase is not connected.' }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Malformed webhook body.' }, 400);
  }

  /*
   * Everything past this line is trusted, and nothing before it is. Anyone can
   * POST to this URL claiming an order was paid; the checksum signature is the
   * only thing separating a real payment from a free basket of yarn.
   */
  let data;
  try {
    data = await payos.webhooks.verify(body as never);
  } catch (cause) {
    console.error('payOS webhook signature rejected', String(cause));
    return json({ error: 'Bad signature.' }, 401);
  }

  const { data: found } = await admin
    .from('orders')
    .select('*')
    .eq('provider_order_code', data.orderCode)
    .maybeSingle();

  const order = found as Order | null;
  if (!order) {
    /*
     * payOS sends a probe with a dummy orderCode when the URL is registered, so
     * an unknown code is expected traffic rather than an error. Answering 200
     * is also what stops a genuine mismatch being retried forever.
     */
    return json({ success: true, note: 'No matching order.' });
  }

  if (order.payment_status === 'paid') {
    return json({ success: true, note: 'Already settled.' });
  }

  /*
   * Check the money, not just the notification. A transfer for the wrong amount
   * is a real thing — a customer editing the amount in their banking app — and
   * settling on it would ship goods that were never paid for.
   */
  const expected = Number(order.amount_charged ?? 0);
  if (expected > 0 && data.amount < expected) {
    console.error('payOS underpayment', order.order_number, data.amount, 'of', expected);
    await admin
      .from('orders')
      .update({
        customer_note: [
          order.customer_note,
          `⚠ Underpaid: received ${data.amount} of ${expected} VND (ref ${data.reference}).`,
        ]
          .filter(Boolean)
          .join('\n'),
      })
      .eq('id', order.id);

    return json({ success: true, note: 'Underpaid — flagged for review.' });
  }

  const result = await settleOrder(admin, order.id, data.reference ?? null);
  return json({ success: true, result });
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
