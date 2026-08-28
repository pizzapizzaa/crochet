export const prerender = false;

import type { APIRoute } from 'astro';
import { authorizeImport, jsonFor, preflight } from '../../../lib/apiAuth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

/*
 * The category list, for callers that are not one of our own pages — which
 * today means the browser extension, so its popup can offer somewhere to file
 * what it is importing instead of dropping everything in the holding pen.
 */

export const OPTIONS: APIRoute = ({ request }) => preflight(request);

async function list(request: Request, cookies: Parameters<typeof authorizeImport>[1], token?: unknown) {
  const { denied } = authorizeImport(request, cookies, token);
  if (denied) return denied;

  const admin = getSupabaseAdmin();
  if (!admin) return jsonFor(request, { error: 'Supabase is not connected.' }, 500);

  const { data, error } = await admin
    .from('categories')
    .select('id, name, is_active')
    .order('display_order', { ascending: true })
    .order('name');

  if (error) return jsonFor(request, { error: `Could not read categories: ${error.message}` }, 500);

  return jsonFor(request, { categories: data ?? [] });
}

/** For our own pages and for anything happy to send an Authorization header. */
export const GET: APIRoute = ({ request, cookies }) => list(request, cookies);

/**
 * Same list, asked for with the token in the body. A POST to read is odd, but
 * it is the shape that crosses an origin without a preflight, and the
 * extension needs this list before it can offer anywhere to file an import.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  let token: unknown;
  try {
    token = ((await request.json()) as Record<string, unknown>)?.token;
  } catch {
    token = undefined;
  }
  return list(request, cookies, token);
};
