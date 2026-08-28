import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Order, OrderEventKind, OrderStatus } from './database.types';

/*
 * Everything that happens to an order after the money lands.
 *
 * shop-schema.sql and lib/orders.ts get paid; this file decides where a parcel
 * is allowed to go next, where the customer can follow it, and what gets
 * written down about it. Both the POS and the customer's receipt read their
 * timeline from here, which is the only way the two can agree on what
 * "shipped" means.
 */

type Admin = SupabaseClient<Database>;
type OrderUpdate = Database['public']['Tables']['orders']['Update'];

/* ── CARRIERS ───────────────────────────────────────────────────────────
 *
 * The shop posts from Binh Loi Trung, so the list leads with the couriers that
 * actually collect there and keeps a couple of international ones for the
 * orders that leave Vietnam. `track` builds the customer-facing lookup URL from
 * a consignment number.
 *
 * "Other" exists so a courier nobody here has used before is still recordable:
 * it takes a pasted URL instead of building one. That matters more than the
 * list being complete — a parcel handed to a courier we have no entry for must
 * not become an untrackable parcel.
 */
export interface Carrier {
  key: string;
  label: string;
  /** Null when this carrier has no public lookup we can link to. */
  track: ((consignment: string) => string) | null;
}

export const CARRIERS: Carrier[] = [
  {
    key: 'vnpost',
    label: 'Vietnam Post',
    track: (n) => `https://www.vnpost.vn/tra-cuu-hanh-trinh?key=${encodeURIComponent(n)}`,
  },
  {
    key: 'viettelpost',
    label: 'Viettel Post',
    track: (n) => `https://viettelpost.vn/tra-cuu-hanh-trinh-don/?peopleTracking=${encodeURIComponent(n)}`,
  },
  {
    key: 'ghn',
    label: 'Giao Hàng Nhanh',
    track: (n) => `https://donhang.ghn.vn/?order_code=${encodeURIComponent(n)}`,
  },
  {
    key: 'ghtk',
    label: 'Giao Hàng Tiết Kiệm',
    track: (n) => `https://i.ghtk.vn/${encodeURIComponent(n)}`,
  },
  {
    key: 'jt',
    label: 'J&T Express',
    track: (n) => `https://jtexpress.vn/vi/tracking?type=track&billcode=${encodeURIComponent(n)}`,
  },
  {
    key: 'dhl',
    label: 'DHL',
    track: (n) => `https://www.dhl.com/vn-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  },
  {
    key: 'ems',
    label: 'EMS (international)',
    track: (n) => `https://www.ems.com.vn/tracking?code=${encodeURIComponent(n)}`,
  },
  { key: 'inperson', label: 'Delivered in person', track: null },
  { key: 'other', label: 'Other courier', track: null },
];

export const carrierByKey = (key: string | null): Carrier | null =>
  CARRIERS.find((c) => c.key === key) ?? null;

export const carrierLabel = (key: string | null): string =>
  carrierByKey(key)?.label ?? key ?? '';

/**
 * Where the customer should click to follow this parcel.
 *
 * A URL saved on the order always wins: it was either pasted in by hand for a
 * courier we cannot build a link for, or it is the one the carrier itself gave
 * us. Only when there is none is a link built from the carrier and the number.
 */
export function trackingLink(order: Order): string | null {
  if (order.tracking_url) return order.tracking_url;
  if (!order.tracking_number) return null;
  return carrierByKey(order.carrier)?.track?.(order.tracking_number) ?? null;
}

/* ── TRANSITIONS ────────────────────────────────────────────────────────
 *
 * What an order in one state is allowed to become. Anything not listed is
 * refused, which is the point: before this, the status dropdown would happily
 * mark an unpaid order delivered, or walk a cancelled one back to shipped.
 *
 * Backwards moves are allowed where they are corrections a human genuinely
 * makes — mis-clicked "shipped", a parcel that came back — and refused where
 * they would be rewriting history instead. Nothing here can be forced from the
 * UI; a genuinely stuck order is fixed in Supabase, deliberately.
 */
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'shipped', 'cancelled'],
  processing: ['pending', 'shipped', 'cancelled'],
  shipped: ['processing', 'delivered', 'cancelled'],
  // A delivered order is done. The one way out is the mis-click that put it
  // there; anything else — a return, a complaint — is a refund, not a status.
  delivered: ['shipped'],
  // Reopening drops it back to the start rather than to wherever it was, so
  // the parcel gets looked at again rather than being assumed still packed.
  cancelled: ['pending'],
};

/** Statuses that only mean something once the money is actually in. */
const NEEDS_PAYMENT: OrderStatus[] = ['processing', 'shipped', 'delivered'];

export interface TransitionCheck {
  ok: boolean;
  /** Why not, phrased for the shop owner reading a flash message. */
  reason?: string;
}

export function checkTransition(order: Order, next: OrderStatus): TransitionCheck {
  if (order.status === next) {
    return { ok: false, reason: `This order is already ${next}.` };
  }

  if (NEEDS_PAYMENT.includes(next) && order.payment_status !== 'paid') {
    return {
      ok: false,
      reason:
        order.payment_status === 'refunded'
          ? 'This order was refunded, so it cannot be worked on. Reopen it by taking payment again.'
          : `This order is ${order.payment_status}. Nothing ships before the money is in — cancel it instead.`,
    };
  }

  if (!ALLOWED[order.status].includes(next)) {
    return {
      ok: false,
      reason: `An order cannot go from ${order.status} to ${next}. Allowed from here: ${ALLOWED[
        order.status
      ].join(', ')}.`,
    };
  }

  return { ok: true };
}

/** The statuses the dropdown should offer, given where the order is now. */
export const nextStatuses = (order: Order): OrderStatus[] =>
  ALLOWED[order.status].filter(
    (s) => !NEEDS_PAYMENT.includes(s) || order.payment_status === 'paid',
  );

/**
 * The column that records when an order reached a given state.
 *
 * Stamped on the way in, and wiped on the way back out: an order corrected
 * from shipped to processing did not ship, so keeping the date it "shipped"
 * would leave a fact behind that never happened. The one thing worse than no
 * timestamp is a confident wrong one.
 */
const STAMP = {
  shipped: 'shipped_at',
  delivered: 'delivered_at',
  cancelled: 'cancelled_at',
} as const satisfies Partial<Record<OrderStatus, string>>;

type StampPatch = Partial<Record<(typeof STAMP)[keyof typeof STAMP], string | null>>;

/** Stamp the status being entered, and clear anything it has walked back past. */
function stampsFor(order: Order, next: OrderStatus, at: string): StampPatch {
  const patch: StampPatch = {};

  // Any linear step clears the cancellation — the order is back on the track.
  patch.cancelled_at = next === 'cancelled' ? at : null;

  if (next === 'shipped') {
    /*
     * Only stamp a dispatch date this order does not already have. The one way
     * into 'shipped' from ahead of it is correcting a mis-clicked 'delivered',
     * and that parcel still went out when it went out — restamping it today
     * would rewrite the one date the customer may be counting from.
     */
    if (!order.shipped_at) patch.shipped_at = at;
    patch.delivered_at = null;
  } else if (next === 'delivered') {
    patch.delivered_at = at;
  } else if (next !== 'cancelled') {
    // Walked back behind dispatch: it has not shipped and it has not arrived.
    patch.shipped_at = null;
    patch.delivered_at = null;
  }

  // Cancelling leaves the dispatch dates alone — a parcel that shipped and was
  // then called off did still ship, and that is worth still being able to see.

  return patch;
}

export interface StatusChange {
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  /** Put this order's units back on the shelf as part of cancelling it. */
  restock?: boolean;
  actor?: string;
}

export interface StatusResult {
  ok: boolean;
  message: string;
}

/**
 * Move one order, and write down that it moved.
 *
 * The single door every status change goes through — the detail page, the bulk
 * bar and the abandoned-order sweep all call this, so the rules, the
 * timestamps and the history cannot be true in one place and skipped in
 * another.
 */
export async function applyStatus(
  admin: Admin,
  order: Order,
  next: OrderStatus,
  change: StatusChange = {},
): Promise<StatusResult> {
  const check = checkTransition(order, next);
  if (!check.ok) return { ok: false, message: check.reason ?? 'That change is not allowed.' };

  const actor = change.actor ?? 'staff';
  const at = new Date().toISOString();

  const patch: OrderUpdate = { status: next, ...stampsFor(order, next, at) };

  // Tracking details ride along with the move to 'shipped' rather than being a
  // second form: a parcel gets its consignment number at the moment it goes.
  if (change.carrier !== undefined) patch.carrier = change.carrier || null;
  if (change.trackingNumber !== undefined) patch.tracking_number = change.trackingNumber || null;
  if (change.trackingUrl !== undefined) patch.tracking_url = change.trackingUrl || null;

  const { error } = await admin.from('orders').update(patch).eq('id', order.id);
  if (error) return { ok: false, message: `Could not update: ${error.message}` };

  await logEvent(admin, {
    orderId: order.id,
    kind: 'status',
    from: order.status,
    to: next,
    message: change.trackingNumber
      ? `Marked ${next} — ${carrierLabel(change.carrier ?? null)} ${change.trackingNumber}`.trim()
      : `Marked ${next}.`,
    actor,
  });

  /*
   * Restocking is deliberately a separate, opt-in step rather than something
   * cancelling does on its own. By the time an order is called off the yarn may
   * well have been wound, and putting it back would be inventing stock that no
   * longer exists in that form.
   */
  if (next === 'cancelled' && change.restock && order.stock_committed) {
    const { error: restockError } = await admin.rpc('restock_order', { p_order_id: order.id });
    if (restockError) {
      return {
        ok: true,
        message: `Cancelled, but the stock could not be put back: ${restockError.message}`,
      };
    }
    return { ok: true, message: 'Cancelled and the stock is back on the shelf.' };
  }

  return { ok: true, message: `Marked ${next}.` };
}

/* ── HISTORY ────────────────────────────────────────────────────────────  */

export interface EventEntry {
  orderId: string;
  kind: OrderEventKind;
  from?: string | null;
  to?: string | null;
  message?: string | null;
  /** 'staff' for anything done from the POS, 'system' for a webhook or sweep. */
  actor?: string;
}

/**
 * Write a line into the order's history.
 *
 * Deliberately swallows its own failure. The history is worth a lot, but not
 * as much as the action it describes: an order that shipped must not report an
 * error because the log line did not save. A failure here is loud in the
 * server logs and invisible to the shop owner, which is the right way round.
 */
export async function logEvent(admin: Admin, entry: EventEntry): Promise<void> {
  const { error } = await admin.from('order_events').insert({
    order_id: entry.orderId,
    kind: entry.kind,
    from_status: entry.from ?? null,
    to_status: entry.to ?? null,
    message: entry.message ?? null,
    actor: entry.actor ?? 'system',
  });

  if (error) console.error('order_events insert failed', entry.orderId, error.message);
}

/**
 * Raise the flag that puts an order in front of a human.
 *
 * This used to be an append to customer_note, which meant our warnings and the
 * customer's own words shared a field and finding broken orders meant grepping
 * for an emoji. The note is still appended to — it is where the detail lives
 * and the POS prints it — but the flag is what the list filters on.
 */
export async function flagForAttention(
  admin: Admin,
  order: Pick<Order, 'id' | 'customer_note'>,
  reason: string,
  detail: string,
): Promise<void> {
  await admin
    .from('orders')
    .update({
      needs_attention: true,
      attention_reason: reason,
      // Appended, never replaced — the customer's own note still matters.
      customer_note: [order.customer_note, detail].filter(Boolean).join('\n'),
    })
    .eq('id', order.id);

  await logEvent(admin, { orderId: order.id, kind: 'attention', message: detail });
}

/* ── THE CUSTOMER'S TIMELINE ────────────────────────────────────────────  */

export interface TimelineStep {
  status: OrderStatus;
  label: string;
  /** What the customer is told is happening at this step. */
  copy: string;
  done: boolean;
  current: boolean;
  /** When this step happened, if we know. */
  at: string | null;
}

const STEPS: { status: OrderStatus; label: string; copy: string }[] = [
  { status: 'pending', label: 'Ordered', copy: 'We have your order and are getting to it.' },
  { status: 'processing', label: 'Being made', copy: 'It is being made and packed right now.' },
  { status: 'shipped', label: 'On its way', copy: 'It is on its way to you.' },
  { status: 'delivered', label: 'Delivered', copy: 'Delivered — we hope you love it.' },
];

/**
 * The four steps of a parcel's life, with the ones already behind it marked.
 *
 * A cancelled order has left the track entirely and gets an empty timeline
 * rather than a half-filled one, because a progress bar frozen at step two is
 * a worse answer than no progress bar at all.
 *
 * "Ordered" is only counted as done once the money is in. Before that the
 * order exists but nothing is happening, and lighting the first step would
 * tell someone staring at "awaiting payment" that we were already on it.
 */
export function timeline(order: Order): TimelineStep[] {
  if (order.status === 'cancelled') return [];

  const reached = STEPS.findIndex((s) => s.status === order.status);
  const paid = order.payment_status === 'paid';

  const at: Record<OrderStatus, string | null> = {
    pending: order.paid_at,
    processing: null,
    shipped: order.shipped_at,
    delivered: order.delivered_at,
    cancelled: order.cancelled_at,
  };

  return STEPS.map((step, i) => ({
    ...step,
    done: paid && i <= reached,
    current: paid && i === reached,
    at: at[step.status],
  }));
}

/** The one-line answer to "where is my order?", for the top of the receipt. */
export function statusCopy(order: Order): string {
  if (order.status === 'cancelled') {
    return order.payment_status === 'refunded'
      ? 'This order was cancelled and refunded.'
      : 'This order was cancelled.';
  }
  if (order.payment_status !== 'paid') return 'We have not seen your payment yet.';
  return STEPS.find((s) => s.status === order.status)?.copy ?? '';
}
