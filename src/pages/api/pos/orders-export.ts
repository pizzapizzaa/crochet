export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { applyFilter, readFilter, toCsv } from '../../../lib/posOrders';
import type { Order } from '../../../lib/database.types';

/*
 * The order book as a spreadsheet.
 *
 * Follows whatever the list page is showing — the same tab, the same search —
 * so "give me the shipped ones for March" is a filter and a click rather than a
 * second set of controls to keep in step with the first.
 *
 * Deliberately not paginated: an export of page one of nine would be a trap.
 * The cap below is there so a runaway cannot try to build a 200MB string in a
 * serverless function's memory, and it says so in the file when it bites.
 */
const MAX_ROWS = 5000;

export const GET: APIRoute = async ({ url, cookies }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const admin = getSupabaseAdmin();
  if (!admin) return new Response('Supabase is not connected.', { status: 503 });

  const filter = readFilter(url.searchParams);

  const { data, error } = await applyFilter(admin.from('orders').select('*'), filter)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return new Response(`Could not export: ${error.message}`, { status: 500 });
  }

  const orders = (data ?? []) as Order[];
  let body = toCsv(orders);

  // Silence about a truncated export is how a partial file gets filed as a
  // complete one. If the cap bit, the file says so on its own last line.
  if (orders.length === MAX_ROWS) {
    body += `\r\n"Truncated at ${MAX_ROWS} orders — narrow the filter and export again."`;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `zippyzack-orders-${filter.status}-${stamp}.csv`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
};
