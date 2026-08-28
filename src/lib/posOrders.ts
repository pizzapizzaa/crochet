import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Order } from './database.types';
import { ORDER_STATUSES } from './database.types';
import { formatAddress, orderItems, shippingAddress } from './orders';
import { carrierLabel } from './fulfilment';

/*
 * Reading the order book.
 *
 * The list page used to pull 200 rows and filter them in the browser, which
 * meant every tab count, the revenue figure and the search were all quietly
 * scoped to the newest 200 orders — order 201 did not exist as far as the POS
 * was concerned. Everything here runs in the database instead, so a filter
 * that says "3 shipped" means three, and page 9 is reachable.
 *
 * Shared by the list, the CSV export and the bulk actions, so all three agree
 * on what a tab means.
 */

type Admin = SupabaseClient<Database>;

export const PAGE_SIZE = 25;

export interface OrderFilter {
  /** A tab key: 'open', 'attention', 'all', 'unpaid', or one of ORDER_STATUSES. */
  status: string;
  q: string;
  page: number;
}

export const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'attention', label: 'Needs a human' },
  { key: 'all', label: 'All' },
  ...ORDER_STATUSES.map((s) => ({ key: s as string, label: s[0].toUpperCase() + s.slice(1) })),
  { key: 'unpaid', label: 'Awaiting payment' },
];

const TAB_KEYS = new Set(TABS.map((t) => t.key));

/** Whatever was in the query string, reduced to something we can act on. */
export function readFilter(params: URLSearchParams): OrderFilter {
  const status = params.get('status') ?? 'open';
  const page = Number(params.get('page') ?? '1');

  return {
    status: TAB_KEYS.has(status) ? status : 'open',
    q: (params.get('q') ?? '').trim().slice(0, 100),
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) : 1,
  };
}

/*
 * PostgREST's `or` takes a comma-separated list inside a string, so a comma or
 * a bracket in the search box would be read as syntax rather than as text.
 * Stripping them is enough — none of them appear in an order number, a name or
 * an email in a way worth searching for.
 */
const sanitise = (q: string) => q.replace(/[,()\\*]/g, ' ').trim();

/** The subset of the query builder this file needs, so both callers type-check. */
interface Filterable {
  eq(column: string, value: unknown): this;
  neq(column: string, value: unknown): this;
  not(column: string, operator: string, value: unknown): this;
  or(filters: string): this;
}

/**
 * Narrow a query to one tab and one search term.
 *
 * Applied identically to the page of rows and to every tab count, which is
 * what stops the counts drifting from the list beneath them: search for a name
 * and the tabs show how many of *those* are shipped, not how many exist.
 */
export function applyFilter<T extends Filterable>(query: T, filter: OrderFilter): T {
  let q = query;

  if (filter.status === 'open') {
    // Everything still owed work: paid for, not finished, not called off.
    q = q.eq('payment_status', 'paid').not('status', 'in', '(delivered,cancelled)');
  } else if (filter.status === 'attention') {
    q = q.eq('needs_attention', true);
  } else if (filter.status === 'unpaid') {
    // Still waiting, specifically. A swept or refunded order is settled — it is
    // simply not settled in our favour — and lumping those in here is what made
    // this tab useless as a to-do list.
    q = q.eq('payment_status', 'unpaid');
  } else if ((ORDER_STATUSES as string[]).includes(filter.status)) {
    q = q.eq('status', filter.status);
  }

  const term = sanitise(filter.q);
  if (term) {
    q = q.or(
      [
        `order_number.ilike.%${term}%`,
        `customer_name.ilike.%${term}%`,
        `customer_email.ilike.%${term}%`,
        `tracking_number.ilike.%${term}%`,
      ].join(','),
    );
  }

  return q;
}

export interface OrderPage {
  rows: Order[];
  /** How many orders match the filter in total, not just on this page. */
  total: number;
  page: number;
  pageCount: number;
  error: string | null;
}

export async function loadOrders(admin: Admin, filter: OrderFilter): Promise<OrderPage> {
  const from = (filter.page - 1) * PAGE_SIZE;

  const { data, count, error } = await applyFilter(
    admin.from('orders').select('*', { count: 'exact' }),
    filter,
  )
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    return { rows: [], total: 0, page: filter.page, pageCount: 1, error: error.message };
  }

  const total = count ?? 0;
  return {
    rows: (data ?? []) as Order[],
    total,
    page: filter.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    error: null,
  };
}

/**
 * How many orders sit behind each tab, for the same search term.
 *
 * One `head` count per tab rather than one big fetch: they run together, they
 * move no rows over the wire, and they stay correct at any number of orders.
 */
export async function tabCounts(admin: Admin, q: string): Promise<Record<string, number>> {
  const results = await Promise.all(
    TABS.map(async (tab) => {
      const { count } = await applyFilter(
        admin.from('orders').select('id', { count: 'exact', head: true }),
        { status: tab.key, q, page: 1 },
      );
      return [tab.key, count ?? 0] as const;
    }),
  );

  return Object.fromEntries(results);
}

/** Money taken across every paid order — the whole book, not one page of it. */
export async function totalTaken(admin: Admin): Promise<{ revenue: number; orders: number }> {
  const { data, error } = await admin
    .from('orders')
    .select('total')
    .eq('payment_status', 'paid');

  if (error || !data) return { revenue: 0, orders: 0 };

  return {
    revenue: data.reduce((sum, row) => sum + Number((row as { total: number }).total), 0),
    orders: data.length,
  };
}

/* ── CSV ────────────────────────────────────────────────────────────────
 *
 * For the accountant, and for the day this shop moves to a platform that wants
 * its order history imported. Every column an order has that a human would ask
 * about, flattened — one row per order, items summarised rather than exploded,
 * because a spreadsheet with one line per order is the thing people can use.
 */

/** RFC 4180: quote everything, double the quotes inside. Safe for any value. */
const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
};

const CSV_HEADERS = [
  'Order number',
  'Placed',
  'Paid',
  'Status',
  'Payment',
  'Needs attention',
  'Customer',
  'Email',
  'Phone',
  'Address',
  'Items',
  'Item count',
  'Subtotal (USD)',
  'Shipping (USD)',
  'Total (USD)',
  'Charged',
  'Currency',
  'Carrier',
  'Tracking number',
  'Shipped',
  'Delivered',
  'Cancelled',
  'Refunded',
  'Bank reference',
  'Note',
];

export function toCsv(orders: Order[]): string {
  const rows = orders.map((order) => {
    const items = orderItems(order);
    const count = items.lines.reduce((sum, l) => sum + l.qty, 0);
    const summary = items.lines.map((l) => `${l.qty} x ${l.name}`).join('; ');

    return [
      order.order_number,
      order.created_at,
      order.paid_at,
      order.status,
      order.payment_status,
      order.needs_attention ? 'yes' : '',
      order.customer_name,
      order.customer_email,
      order.customer_phone,
      formatAddress(shippingAddress(order)).join(', '),
      summary,
      count,
      order.subtotal,
      order.shipping_total,
      order.total,
      order.amount_charged,
      order.charged_currency,
      carrierLabel(order.carrier),
      order.tracking_number,
      order.shipped_at,
      order.delivered_at,
      order.cancelled_at,
      order.refunded_at,
      order.payment_reference,
      order.customer_note,
    ].map(cell);
  });

  /*
   * A leading BOM. Excel opens a UTF-8 CSV as the local codepage without one,
   * which turns every Vietnamese address in the file into mojibake.
   */
  return '﻿' + [CSV_HEADERS.map(cell).join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}
