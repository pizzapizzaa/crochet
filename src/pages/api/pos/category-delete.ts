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
  const back = safeNext(form, '/pos/categories');

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  }
  if (!id) {
    return redirect(withFlash(back, 'error', 'No category was named for deletion.'));
  }

  const [{ data: existing }, { count }] = await Promise.all([
    admin.from('categories').select('name').eq('id', id).maybeSingle(),
    admin.from('products').select('id', { count: 'exact', head: true }).eq('category_id', id),
  ]);

  // The FK is ON DELETE SET NULL, so products survive as uncategorised rather
  // than disappearing with the category.
  const { error } = await admin.from('categories').delete().eq('id', id);
  if (error) {
    return redirect(withFlash(back, 'error', `Could not delete: ${error.message}`));
  }

  const orphaned = count ?? 0;
  const tail = orphaned
    ? ` ${orphaned} product${orphaned === 1 ? ' is' : 's are'} now uncategorised.`
    : '';

  return redirect(
    withFlash(back, 'ok', `Deleted ${existing?.name ? `"${existing.name}"` : 'the category'}.${tail}`),
  );
};
