import type { APIRoute } from 'astro';
import { guardApi } from '../../../../lib/auth';
import { isCrossOrigin } from '../../../../lib/apiAuth';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { parsePattern } from '../../../../lib/patternDesigner';
import type { Json } from '../../../../lib/database.types';

export const prerender = false;
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const unavailable = () => json({ error: 'Pattern storage is unavailable. Configure Supabase and run supabase/pattern-designs-schema.sql. Your local draft and exports remain available.' }, 503);
const conflict = () => json({ error: 'This pattern changed in another tab or was deleted. Reopen the cloud version, or duplicate your local pattern to save it separately.' }, 409);

export const GET: APIRoute = async ({ cookies, params }) => {
  const denied = guardApi(cookies);
  if (denied) return json({ error: 'Sign in again to access your patterns.' }, 401);
  const admin = getSupabaseAdmin();
  if (!admin) return unavailable();
  const id = params.id;
  if (id && !validId(id)) return json({ error: 'Invalid pattern ID.' }, 400);
  if (!id) {
    const { data, error } = await admin.from('pattern_designs').select('id, title, revision, updated_at').order('updated_at', { ascending: false }).limit(200);
    return error ? unavailable() : json(data);
  }
  const { data, error } = await admin.from('pattern_designs').select('*').eq('id', id).maybeSingle();
  if (error) return unavailable();
  return data ? json(data) : json({ error: 'This pattern has not been saved to the cloud or was deleted.' }, 404);
};

export const PUT: APIRoute = async ({ request, cookies, params }) => {
  if (guardApi(cookies)) return json({ error: 'Sign in again to save your pattern.' }, 401);
  if (isCrossOrigin(request)) return json({ error: 'Cross-origin saves are not allowed.' }, 403);
  const id = params.id;
  if (!id || !validId(id)) return json({ error: 'Invalid pattern ID.' }, 400);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Expected JSON.' }, 415);
  let document;
  let revision: number;
  try {
    const text = await request.text();
    if (text.length > 3000000) return json({ error: 'Pattern exceeds the 3 MB limit.' }, 413);
    const body = JSON.parse(text);
    document = parsePattern(body.document);
    revision = body.revision;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > 2147483646) throw new Error('Invalid revision.');
  } catch (reason) { return json({ error: (reason as Error).message || 'Invalid pattern.' }, 400); }
  const admin = getSupabaseAdmin();
  if (!admin) return unavailable();
  const values = { title: document.title, document: document as unknown as Json, revision: revision + 1, updated_at: new Date().toISOString() };
  if (revision === 0) {
    const { data, error } = await admin.from('pattern_designs').insert({ id, ...values }).select().single();
    if (error?.code === '23505') return conflict();
    return error ? unavailable() : json(data, 201);
  }
  const { data, error } = await admin.from('pattern_designs').update(values).eq('id', id).eq('revision', revision).select().maybeSingle();
  if (error) return unavailable();
  return data ? json(data) : conflict();
};

export const DELETE: APIRoute = async ({ request, cookies, params, url }) => {
  if (guardApi(cookies)) return json({ error: 'Sign in again to delete a pattern.' }, 401);
  if (isCrossOrigin(request)) return json({ error: 'Cross-origin deletes are not allowed.' }, 403);
  const id = params.id;
  const revision = Number(url.searchParams.get('revision'));
  if (!id || !validId(id) || !Number.isSafeInteger(revision) || revision < 1) return json({ error: 'Invalid pattern ID or revision.' }, 400);
  const admin = getSupabaseAdmin();
  if (!admin) return unavailable();
  const { data, error } = await admin.from('pattern_designs').delete().eq('id', id).eq('revision', revision).select('id');
  if (error) return unavailable();
  return data?.length ? json({ deleted: id }) : conflict();
};