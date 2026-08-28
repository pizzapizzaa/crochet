import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Order } from './database.types';
import { settleOrder } from './orders';
import { readPayment } from './payos';
import { logEvent } from './fulfilment';
import { PAYMENT_WINDOW_MINUTES } from './shop';

/*
 * Clearing out the checkouts nobody finished.
 *
 * An order row is written before the customer ever reaches payOS — deliberately,
 * because a payment arriving with nothing to attach it to is the far worse
 * failure. The cost is that every abandoned basket leaves an unpaid row behind,
 * and with nothing to clear them they accumulate for the life of the shop until
 * the "not paid" tab is a wall of noise and a genuinely stuck order is invisible
 * inside it.
 *
 * ── IT ASKS BEFORE IT CANCELS ───────────────────────────────────────────────
 * The obvious version of this deletes anything unpaid and old. That version
 * eventually cancels an order somebody really paid for, because both settlement
 * paths can fail at once: a webhook that never arrived and a customer who closed
 * the tab before the receipt loaded leave a paid order looking exactly like an
 * abandoned one.
 *
 * So every candidate is checked against payOS first. In practice this makes the
 * sweep a reconciliation pass that happens to tidy up — the third and last
 * chance for a real payment to be noticed, after the webhook and the receipt.
 */

type Admin = SupabaseClient<Database>;

/** Kept small: this runs in a serverless function with a wall clock. */
const BATCH = 40;

export interface SweepResult {
  /** Orders that turned out to have been paid all along. */
  rescued: number;
  cancelled: number;
  /** Checked but left alone — payOS could not be reached, or is not configured. */
  skipped: number;
  message: string;
}

export async function sweepAbandoned(admin: Admin): Promise<SweepResult> {
  /*
   * Anything whose payment window has closed. Orders placed before that column
   * existed have no expiry, so they fall back to the same window measured from
   * when they were created — otherwise the oldest rows, which are the ones most
   * worth clearing, would be the only ones the sweep could never touch.
   */
  const now = Date.now();
  const cutoff = new Date(now - PAYMENT_WINDOW_MINUTES * 60_000).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data, error } = await admin
    .from('orders')
    .select('*')
    .eq('payment_status', 'unpaid')
    .or(`payment_expires_at.lt.${nowIso},and(payment_expires_at.is.null,created_at.lt.${cutoff})`)
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    return { rescued: 0, cancelled: 0, skipped: 0, message: `Could not sweep: ${error.message}` };
  }

  const stale = (data ?? []) as Order[];
  if (stale.length === 0) {
    return { rescued: 0, cancelled: 0, skipped: 0, message: 'Nothing to sweep.' };
  }

  let rescued = 0;
  let cancelled = 0;
  let skipped = 0;

  for (const order of stale) {
    // Ask payOS before writing anything off.
    if (order.provider_order_code) {
      try {
        const payment = await readPayment(Number(order.provider_order_code));
        if (payment.paid) {
          await settleOrder(admin, order.id, payment.reference);
          rescued += 1;
          continue;
        }
      } catch (cause) {
        /*
         * payOS unreachable. Skipping costs one more day of an unpaid row;
         * cancelling on a failed lookup could cancel a paid order. The sweep
         * runs again tomorrow, so the cheap mistake is the one to make.
         */
        console.error('sweep: payOS lookup failed', order.order_number, String(cause));
        skipped += 1;
        continue;
      }
    }

    const { error: cancelError } = await admin
      .from('orders')
      .update({
        status: 'cancelled',
        // 'failed' rather than 'unpaid': we have stopped waiting for this one,
        // which is a different fact from the money not having arrived yet.
        payment_status: 'failed',
        cancelled_at: nowIso,
      })
      .eq('id', order.id)
      // Re-checked at write time. A payment that landed in the seconds since
      // the query above must not be cancelled out from under itself.
      .eq('payment_status', 'unpaid');

    if (cancelError) {
      skipped += 1;
      continue;
    }

    await logEvent(admin, {
      orderId: order.id,
      kind: 'status',
      from: order.status,
      to: 'cancelled',
      message: 'Payment window closed with no transfer — swept.',
      actor: 'system',
    });
    cancelled += 1;
  }

  const parts = [
    cancelled ? `${cancelled} abandoned order${cancelled === 1 ? '' : 's'} cancelled` : '',
    rescued ? `${rescued} turned out to be paid and were settled` : '',
    skipped ? `${skipped} left alone for now` : '',
  ].filter(Boolean);

  return {
    rescued,
    cancelled,
    skipped,
    message: parts.length ? parts.join(', ') + '.' : 'Nothing to sweep.',
  };
}
