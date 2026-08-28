export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { settleOrder } from '../../../lib/orders';
import { flagForAttention, logEvent } from '../../../lib/fulfilment';
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
 *
 * ── EVERY ANSWER IS 200 ─────────────────────────────────────────────────────
 * Except a bad signature. A non-2xx tells payOS to retry, and there is nothing
 * on this route worth retrying: an unknown order, a failed payment and an
 * underpayment are all facts rather than transient errors, and retrying them
 * forever only fills the logs. What each one does instead is leave a record.
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
   * Did it actually succeed?
   *
   * This route used to settle on the strength of being called at all, on the
   * assumption that payOS only calls on success. The payload carries its own
   * result code and the assumption is not worth betting stock on: '00' is
   * success and anything else is a payment that did not happen. Treating a
   * failure notification as a payment would ship goods for nothing.
   */
  const result = (data as { code?: string; desc?: string }).code;
  if (result !== undefined && result !== '00') {
    const desc = (data as { desc?: string }).desc ?? 'no description';
    console.error('payOS reported a failed payment', order.order_number, result, desc);

    await admin.from('orders').update({ payment_status: 'failed' }).eq('id', order.id);
    await logEvent(admin, {
      orderId: order.id,
      kind: 'payment',
      message: `payOS reported the payment failed (${result}: ${desc}).`,
    });

    return json({ success: true, note: 'Payment did not succeed.' });
  }

  /*
   * Check the money, not just the notification. A transfer for the wrong amount
   * is a real thing — a customer editing the amount in their banking app — and
   * settling on it would ship goods that were never paid for.
   */
  const expected = Number(order.amount_charged ?? 0);

  if (expected > 0 && data.amount < expected) {
    console.error('payOS underpayment', order.order_number, data.amount, 'of', expected);

    await flagForAttention(
      admin,
      order,
      `Underpaid — ${data.amount.toLocaleString('vi-VN')}₫ of ${expected.toLocaleString('vi-VN')}₫.`,
      `⚠ Underpaid: received ${data.amount} of ${expected} VND (ref ${data.reference}).`,
    );

    return json({ success: true, note: 'Underpaid — flagged for review.' });
  }

  const settled = await settleOrder(admin, order.id, data.reference ?? null);

  /*
   * Overpayment settles the order — the goods are paid for and then some, and
   * holding the parcel back over it would be the wrong way round — but it is
   * still flagged, because somebody is owed the difference back.
   */
  if (expected > 0 && data.amount > expected) {
    console.error('payOS overpayment', order.order_number, data.amount, 'of', expected);

    await flagForAttention(
      admin,
      // Re-read: settleOrder may have appended to the note a moment ago.
      { id: order.id, customer_note: await currentNote(admin, order.id) },
      `Overpaid by ${(data.amount - expected).toLocaleString('vi-VN')}₫ — owed a refund of the difference.`,
      `⚠ Overpaid: received ${data.amount} of ${expected} VND (ref ${data.reference}).`,
    );
  }

  return json({ success: true, result: settled });
};

/** The note as it stands right now, so an append cannot clobber a fresh one. */
async function currentNote(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  orderId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('orders')
    .select('customer_note')
    .eq('id', orderId)
    .maybeSingle();
  return data?.customer_note ?? null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
