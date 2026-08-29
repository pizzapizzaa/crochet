export const prerender = false;

import type { APIRoute } from 'astro';
import { authorizeImport, jsonFor, preflight } from '../../../lib/apiAuth';
import { RATES } from '../../../lib/currency';

/*
 * The shop's exchange rates, for callers that are not one of our own pages —
 * which today means the browser extension.
 *
 * The extension reads a product off the rendered page in the browser, so
 * unlike the POS import screen there is no server round trip in which a price
 * could be converted before it is shown. Without this it would put a yuan
 * figure in a box labelled dollars and let somebody edit it, which is a worse
 * failure than not converting at all.
 *
 * Rates are served rather than hard-coded into the extension because the
 * extension is loaded unpacked and never updates itself: a rate baked into it
 * in August is still there in March. Fetching means changing FX_RATES in the
 * shop's environment is enough, and the extension and the site can never
 * disagree about what a yuan is worth.
 *
 * Nothing secret is in here — it is a table of numbers — but it stays behind
 * the same door as the rest of /api/pos so there is one rule to reason about
 * rather than an exception.
 */

export const OPTIONS: APIRoute = ({ request }) => preflight(request);

function rates(request: Request, cookies: Parameters<typeof authorizeImport>[1], token?: unknown) {
  const { denied } = authorizeImport(request, cookies, token);
  if (denied) return denied;

  return jsonFor(request, {
    // USD per one unit of each currency, which is the direction that makes the
    // caller's arithmetic a multiplication rather than a division.
    rates: RATES,
    base: 'USD',
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // A GET-shaped POST with no body is fine; the session cookie may carry it.
  }
  return rates(request, cookies, body.token);
};

export const GET: APIRoute = ({ request, cookies }) => rates(request, cookies);
