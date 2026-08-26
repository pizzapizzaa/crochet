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
  const back = safeNext(form, '/pos/products');

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  }
  if (!id) {
    return redirect(withFlash(back, 'error', 'No product was named for deletion.'));
  }

  const { data: existing } = await admin
    .from('products')
    .select('name')
    .eq('id', id)
    .maybeSingle();

  const { error } = await admin.from('products').delete().eq('id', id);
  if (error) {
    return redirect(withFlash(back, 'error', `Could not delete: ${error.message}`));
  }

  return redirect(
    withFlash(back, 'ok', `Deleted ${existing?.name ? `"${existing.name}"` : 'the product'}.`),
  );
};
