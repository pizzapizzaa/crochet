export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { nullableStr, safeNext, str, withFlash } from '../../../lib/posForms';
import { logEvent } from '../../../lib/fulfilment';

/*
 * Put an order in front of a human, or take it back out.
 *
 * Clearing is the one that was missing: an order could be flagged by the
 * payment path and had no way to be un-flagged, so the warning banner outlived
 * whatever caused it and the shop owner learned to read past it. A flag nobody
 * can clear stops being a flag.
 *
 * Raising by hand is here too, for the orders that go wrong in ways no code
 * predicted — a customer who says the parcel never came, a bank transfer that
 * arrived twice. The list has a tab for these, so a note on an order that
 * needs chasing is a note the shop owner will actually find again.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const action = str(form, 'action');
  const reason = nullableStr(form, 'reason');
  const back = safeNext(form, '/pos/orders');

  const admin = getSupabaseAdmin();
  if (!admin) return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  if (!id) return redirect(withFlash(back, 'error', 'No order was named.'));
  if (action !== 'clear' && action !== 'raise') {
    return redirect(withFlash(back, 'error', 'That is not something to do to a flag.'));
  }

  const clearing = action === 'clear';

  const { error } = await admin
    .from('orders')
    .update({
      needs_attention: !clearing,
      attention_reason: clearing ? null : (reason ?? 'Flagged by hand.'),
    })
    .eq('id', id);

  if (error) {
    return redirect(withFlash(back, 'error', `Could not update: ${error.message}`));
  }

  await logEvent(admin, {
    orderId: id,
    kind: 'attention',
    message: clearing ? 'Marked as sorted.' : `Flagged for attention: ${reason ?? 'no reason given'}`,
    actor: 'staff',
  });

  return redirect(
    withFlash(back, 'ok', clearing ? 'Marked as sorted.' : 'Flagged for attention.'),
  );
};
