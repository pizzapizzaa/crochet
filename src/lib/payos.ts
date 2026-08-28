import { PayOS } from '@payos/node';
import { usdToVnd, type PricedCart } from './orders';

/*
 * payOS — VietQR bank transfer.
 *
 * The customer is sent to a payOS page showing a QR code, scans it in their
 * Vietnamese banking app, and the transfer lands in the shop's account. There
 * are no card details anywhere in this flow and no per-transaction fee on
 * payOS's free plan, which is why it is the whole payment stack for now.
 *
 * ── THE SEAM ────────────────────────────────────────────────────────────────
 * This is the ONLY file that knows which payment provider we use. Everything
 * either side of it is provider-agnostic: lib/orders.ts prices the basket and
 * settles the order, and the `orders` table records a provider name, a payment
 * id and a reference without caring who issued them.
 *
 * To add a card provider for international customers later, write a sibling of
 * this file exposing the same two functions — start a payment, and confirm one
 * — then pick between them in api/shop/order-create.ts on whatever signal you
 * choose (currency, country, or a toggle on the checkout page). Nothing else
 * has to move.
 *
 * Needs PAYOS_CLIENT_ID, PAYOS_API_KEY and PAYOS_CHECKSUM_KEY in .env (and in
 * the Vercel dashboard, which does not read .env).
 */

const clientId = import.meta.env.PAYOS_CLIENT_ID as string | undefined;
const apiKey = import.meta.env.PAYOS_API_KEY as string | undefined;
const checksumKey = import.meta.env.PAYOS_CHECKSUM_KEY as string | undefined;

export const PROVIDER = 'payos';
export const isPayOSConfigured = Boolean(clientId && apiKey && checksumKey);

let client: PayOS | null = null;

export function getPayOS(): PayOS | null {
  if (!isPayOSConfigured) return null;
  if (!client) {
    client = new PayOS({ clientId, apiKey, checksumKey });
  }
  return client;
}

/*
 * payOS identifies a payment by an integer it calls orderCode, which has to be
 * unique for the life of the merchant account. Our own ZZ-7K3P9M is letters, so
 * a number is drawn here and stored beside it. Random rather than sequential
 * for the same reason the order number is: a counter tells anyone who buys once
 * exactly how much the shop has ever sold.
 */
export function newOrderCode(): number {
  const bytes = crypto.getRandomValues(new Uint32Array(2));
  // Comfortably inside payOS's ceiling of 9007199254740991, and wide enough
  // that a collision needs roughly a million orders before it is worth worrying.
  return 100_000_000_000 + ((bytes[0] * 0x100000000 + bytes[1]) % 800_000_000_000);
}

/*
 * The description is printed in the bank transfer itself, and payOS caps it at
 * 25 characters — 9 for accounts that are not payOS-linked. "ZZ7K3P9M" is 8, so
 * the order number minus its dash fits either way and is what appears on the
 * shop's bank statement.
 */
export const transferNote = (orderNumber: string) => orderNumber.replace(/-/g, '').slice(0, 9);

export interface StartPaymentInput {
  orderCode: number;
  orderNumber: string;
  priced: PricedCart;
  name: string;
  email: string;
  origin: string;
  /** When the QR stops working. Kept in step with the order's own expiry. */
  expiresAt: Date;
}

export interface StartedPayment {
  /** Where to send the customer's browser. */
  checkoutUrl: string;
  /** payOS's own id for the payment link, kept for support and reconciliation. */
  paymentId: string;
  amountVnd: number;
}

export async function startPayment(input: StartPaymentInput): Promise<StartedPayment> {
  const payos = getPayOS();
  if (!payos) throw new Error('payOS is not configured.');

  const amountVnd = usdToVnd(input.priced.total);
  const back = `${input.origin}/order/${input.orderNumber}?email=${encodeURIComponent(input.email)}`;

  const response = await payos.paymentRequests.create({
    orderCode: input.orderCode,
    amount: amountVnd,
    description: transferNote(input.orderNumber),
    buyerName: input.name,
    buyerEmail: input.email,
    // Shown on the payOS page so the customer can see what they are paying for.
    // Prices here are the VND equivalents, to match the amount being charged.
    items: input.priced.lines.map((line) => ({
      name: line.name.slice(0, 100),
      quantity: line.qty,
      price: usdToVnd(line.unitPrice),
    })),
    returnUrl: back,
    cancelUrl: `${input.origin}/checkout?cancelled=1`,
    /*
     * payOS takes seconds, not milliseconds. Giving the link the same deadline
     * the order carries is what keeps the sweep honest: without it a QR code
     * stays scannable after we have written the order off, and a customer can
     * pay for something already cancelled.
     */
    expiredAt: Math.floor(input.expiresAt.getTime() / 1000),
  });

  return {
    checkoutUrl: response.checkoutUrl,
    paymentId: response.paymentLinkId,
    amountVnd,
  };
}

export interface PaymentState {
  paid: boolean;
  /** The bank transaction reference, once there is one. */
  reference: string | null;
}

/**
 * Ask payOS what actually happened. Used when the customer lands back on the
 * receipt — the browser's return is a hint that a payment may have completed,
 * never proof of it, so the answer comes from payOS rather than the URL.
 */
export async function readPayment(orderCode: number): Promise<PaymentState> {
  const payos = getPayOS();
  if (!payos) return { paid: false, reference: null };

  const link = await payos.paymentRequests.get(orderCode);
  return {
    paid: link.status === 'PAID',
    reference: link.transactions?.[0]?.reference ?? null,
  };
}
