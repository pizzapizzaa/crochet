export const prerender = false;

import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { parseLines, priceCart } from '../../../lib/orders';

/*
 * What is this basket actually worth?
 *
 * The cart drawer and the checkout both draw their totals from here rather than
 * adding up the prices in localStorage, so what the customer is shown is what
 * the server would charge. Public and read-only — it writes nothing.
 */
export const POST: APIRoute = async ({ request }) => {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return json({ error: 'The shop is not connected right now.' }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Could not read that basket.' }, 400);
  }

  const lines = parseLines((body as { lines?: unknown })?.lines);
  if (lines.length === 0) {
    return json({ lines: [], units: [], subtotal: 0, shipping: 0, total: 0, problems: [] });
  }

  const priced = await priceCart(admin, lines);
  return json(priced);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
