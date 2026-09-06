/*
 * The order this browser is waiting on, if there is one.
 *
 * There are no accounts here: an order is found with its number and the email
 * it was placed under, and that pair *is* the credential. So the only way to
 * answer "is this person waiting on a parcel?" is to ask their own browser,
 * which is told once — on the receipt — and told again every time they come
 * back to it, so a delivered order stops counting as one to track.
 *
 * This is a hint for the chrome and never a permission. Everything it holds
 * was printed on the receipt the customer had just read, and /orders/track
 * still asks for the number and the email regardless of what is stored here.
 */

export const OPEN_ORDER_KEY = 'zz_order_v1';

/** Fired at the window when the record changes, so chrome can repaint. */
export const OPEN_ORDER_EVENT = 'order:changed';

/**
 * The two ends of the road. Everything else — pending, processing, shipped —
 * is a parcel still on its way, which is exactly what a tracking link is for.
 */
const SETTLED = ['delivered', 'cancelled'];

/**
 * How long a record survives without being seen again. Someone who ordered
 * once and never opened the receipt afterwards should not be followed by a
 * tracking link for the rest of the year.
 */
const KEEP_DAYS = 60;

export interface OpenOrder {
  number: string;
  email: string;
  status: string;
  /** Epoch ms, from the last time the receipt was seen. */
  savedAt: number;
}

function announce(): void {
  window.dispatchEvent(new Event(OPEN_ORDER_EVENT));
}

/** Read the record, or null if there is nothing worth tracking. */
export function openOrder(): OpenOrder | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(OPEN_ORDER_KEY);
    if (!raw) return null;
    const order = JSON.parse(raw) as OpenOrder;
    if (!order?.number || !order?.email) return null;
    if (SETTLED.includes(order.status)) return null;
    if (Date.now() - order.savedAt > KEEP_DAYS * 86_400_000) return null;
    return order;
  } catch {
    // A hand-edited or half-written record is the same as no record.
    return null;
  }
}

/** Remember an order that is still on its way. */
export function rememberOrder(order: Omit<OpenOrder, 'savedAt'>): void {
  if (typeof localStorage === 'undefined') return;
  if (SETTLED.includes(order.status)) {
    // Finished — but only drop the record if it is this same order. Reading an
    // old delivered receipt should not lose the parcel you are waiting on now.
    if (openOrder()?.number === order.number) forgetOrder();
    return;
  }
  try {
    localStorage.setItem(OPEN_ORDER_KEY, JSON.stringify({ ...order, savedAt: Date.now() }));
  } catch {
    // Private mode, or a full store. The tracking page is still linked from
    // the footer, so this failing costs a shortcut and nothing else.
  }
  announce();
}

/** Forget it — delivered, cancelled, or looked up by somebody else. */
export function forgetOrder(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(OPEN_ORDER_KEY);
  } catch {}
  announce();
}
