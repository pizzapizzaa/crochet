export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { safeNext, str, withFlash } from '../../../lib/posForms';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const back = safeNext(form, '/pos/makes');

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  }
  if (!id) {
    return redirect(withFlash(back, 'error', 'No make was named for deletion.'));
  }

  const { data: existing } = await admin.from('makes').select('title').eq('id', id).maybeSingle();

  // make_items cascade with the make. The products themselves are untouched —
  // they are stock we sell on their own, the bundle was only a grouping.
  const { error } = await admin.from('makes').delete().eq('id', id);
  if (error) {
    return redirect(withFlash(back, 'error', `Could not delete: ${error.message}`));
  }

  return redirect(
    withFlash(
      back,
      'ok',
      `Deleted ${existing?.title ? `“${existing.title}”` : 'the make'}. The materials it used are still in the shop.`,
    ),
  );
};
