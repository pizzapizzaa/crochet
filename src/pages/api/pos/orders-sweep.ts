export const prerender = false;

import type { APIRoute } from 'astro';
import { isAuthed } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { safeNext, withFlash } from '../../../lib/posForms';
import { sweepAbandoned } from '../../../lib/sweep';

/*
 * Clear out the checkouts nobody finished. See lib/sweep.ts for what that
 * actually involves — in short, it asks payOS before it writes anything off.
 *
 * Two ways in, because it has two callers:
 *   POST — the button on /pos/orders, answered with a redirect and a flash
 *   GET  — the nightly Vercel cron, answered with JSON
 *
 * The cron cannot hold a session cookie, so it authenticates with CRON_SECRET
 * instead. Without that variable set the GET is refused outright rather than
 * left open: this route cancels orders, and an unauthenticated endpoint that
 * cancels orders is a way to be griefed by anyone who reads vercel.json.
 */

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!isAuthed(cookies)) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData();
  const back = safeNext(form, '/pos/orders');

  const admin = getSupabaseAdmin();
  if (!admin) return redirect(withFlash(back, 'error', 'Supabase is not connected.'));

  const result = await sweepAbandoned(admin);
  return redirect(withFlash(back, 'ok', result.message));
};

export const GET: APIRoute = async ({ request, cookies }) => {
  const secret = import.meta.env.CRON_SECRET;
  const authorised =
    isAuthed(cookies) ||
    (Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`);

  if (!authorised) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Supabase is not connected.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await sweepAbandoned(admin);
  console.log('orders sweep:', result.message);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
