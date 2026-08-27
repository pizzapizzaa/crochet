export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import {
  CURRENCY,
  orderNumber,
  parseLines,
  priceCart,
  usdToVnd,
  type ShippingAddress,
} from '../../../lib/orders';
import { isPayOSConfigured, newOrderCode, PROVIDER, startPayment } from '../../../lib/payos';
import type { OrderInsert } from '../../../lib/database.types';

/*
 * Checkout, step one: bank the order, then open a payment with the provider
 * and send the customer to it.
 *
 * The row is written *before* the customer reaches payOS, unpaid and pending,
 * so a payment can never arrive with nothing on our side to attach it to. An
 * abandoned checkout leaves an unpaid row behind, which is by a distance the
 * cheaper of those two failures.
 *
 * Stock is checked here as well as inside commit_order. This check is the
 * polite one — it stops someone being sent to a payment page for something
 * that has sold out. The one in the database is the one that counts.
 */
export const POST: APIRoute = async ({ request }) => {
  const admin = getSupabaseAdmin();
  if (!admin) return json({ error: 'The shop is not connected right now.' }, 503);
  if (!isPayOSConfigured) {
    return json({ error: 'Payments are not switched on yet. Please get in touch.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Could not read that order.' }, 400);
  }

  const name = text(body.name, 120);
  const email = text(body.email, 200).toLowerCase();
  const note = text(body.note, 1000);

  if (!name) return json({ error: 'We need a name for the parcel.' }, 400);
  if (!isEmail(email)) return json({ error: 'That email address does not look right.' }, 400);

  const raw = (body.address ?? {}) as Record<string, unknown>;
  const address: ShippingAddress = {
    line1: text(raw.line1, 200),
    line2: text(raw.line2, 200),
    city: text(raw.city, 120),
    region: text(raw.region, 120),
    postcode: text(raw.postcode, 40),
    country: text(raw.country, 120),
  };

  if (!address.line1) return json({ error: 'We need a street address to post to.' }, 400);
  if (!address.city) return json({ error: 'We need a town or city.' }, 400);
  if (!address.postcode) return json({ error: 'We need a postcode.' }, 400);
  if (!address.country) return json({ error: 'We need a country.' }, 400);

  const requested = parseLines(body.lines);
  if (requested.length === 0) return json({ error: 'Your basket is empty.' }, 400);

  const priced = await priceCart(admin, requested);

  if (priced.problems.length > 0) {
    return json({ error: priced.problems[0].message, problems: priced.problems }, 409);
  }
  if (priced.lines.length === 0 || priced.total <= 0) {
    return json({ error: 'There is nothing to pay for in this basket.' }, 400);
  }

  const number = orderNumber();
  const code = newOrderCode();
  const amountVnd = usdToVnd(priced.total);

  const payload: OrderInsert = {
    order_number: number,
    customer_name: name,
    customer_email: email,
    customer_note: note || null,
    items: { lines: priced.lines, units: priced.units } as unknown as OrderInsert['items'],
    subtotal: priced.subtotal,
    shipping_total: priced.shipping,
    total: priced.total,
    status: 'pending',
    payment_status: 'unpaid',
    shipping_address: address as unknown as OrderInsert['shipping_address'],
    payment_provider: PROVIDER,
    provider_order_code: code,
    // Recorded now rather than recomputed later: the USD→VND rate is a constant
    // we control, and if it is ever changed this is what was really charged.
    amount_charged: amountVnd,
    charged_currency: 'VND',
  };

  const { data: created, error } = await admin
    .from('orders')
    .insert(payload)
    .select('id, order_number')
    .single();

  if (error) {
    return json({ error: `Could not start that order: ${error.message}` }, 500);
  }

  try {
    const payment = await startPayment({
      orderCode: code,
      orderNumber: created.order_number,
      priced,
      name,
      email,
      origin: new URL(request.url).origin,
    });

    await admin
      .from('orders')
      .update({ provider_payment_id: payment.paymentId })
      .eq('id', created.id);

    return json({
      orderNumber: created.order_number,
      url: payment.checkoutUrl,
      amountVnd: payment.amountVnd,
      currency: CURRENCY,
    });
  } catch (cause) {
    // The row stays, marked failed, so an order that never reached payOS is
    // still visible in the POS rather than vanishing without trace.
    await admin.from('orders').update({ payment_status: 'failed' }).eq('id', created.id);

    console.error('payOS payment create failed', String(cause));
    return json({ error: 'We could not open a payment for that. Please try again.' }, 502);
  }
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Deliberately loose: the delivery is the real test, not the regex. */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
