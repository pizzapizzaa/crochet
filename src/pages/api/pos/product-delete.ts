export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isForeignKeyViolation, safeNext, str, withFlash } from '../../../lib/posForms';

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
    // make_items references products with ON DELETE RESTRICT, so a material
    // that is part of a bundle cannot vanish out from under the make that
    // prices itself from it. Name the makes rather than leaking the FK error.
    if (isForeignKeyViolation(error)) {
      const { data: used } = await admin
        .from('make_items')
        .select('make:makes(title)')
        .eq('product_id', id);

      const titles = (used ?? [])
        .map((row) => (row as unknown as { make: { title: string } | null }).make?.title)
        .filter(Boolean) as string[];

      const named = titles.length
        ? ` It is in ${titles.map((t) => `“${t}”`).join(', ')}.`
        : '';

      return redirect(
        withFlash(
          back,
          'error',
          `This material is part of a make's bundle, so it cannot be deleted.${named} Remove it from the bundle first, or unpublish it instead.`,
        ),
      );
    }
    return redirect(withFlash(back, 'error', `Could not delete: ${error.message}`));
  }

  return redirect(
    withFlash(back, 'ok', `Deleted ${existing?.name ? `"${existing.name}"` : 'the product'}.`),
  );
};
