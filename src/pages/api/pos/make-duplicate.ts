export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { copySlug, isUniqueViolation, safeNext, slugify, str, withFlash } from '../../../lib/posForms';
import type { Make, MakeInsert, MakeItemInsert } from '../../../lib/database.types';

/*
 * Copy a make — bundle and all — into a fresh draft and open it.
 *
 * The bundle is the reason to duplicate a make at all, so its rows are copied
 * as they stand and go on pointing at the same products; only the make itself
 * is new. The copy starts unpublished so a half-edited pin credit never lands
 * in the shop.
 */
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
    return redirect(withFlash(back, 'error', 'No make was named for duplication.'));
  }

  const [makeRes, itemRes] = await Promise.all([
    admin.from('makes').select('*').eq('id', id).maybeSingle(),
    admin
      .from('make_items')
      .select('product_id, quantity, note, is_optional, display_order')
      .eq('make_id', id)
      .order('display_order', { ascending: true }),
  ]);

  if (makeRes.error || !makeRes.data) {
    return redirect(withFlash(back, 'error', 'That make no longer exists.'));
  }

  const source = makeRes.data as Make;
  const items = itemRes.data ?? [];

  const stem = slugify(`${source.slug}-copy`);
  const { data: clashes } = await admin.from('makes').select('slug').like('slug', `${stem}%`);
  const slug = copySlug(stem, (clashes ?? []).map((row) => row.slug));

  const payload: MakeInsert = {
    title: `${source.title} (copy)`,
    slug,
    summary: source.summary,
    pinterest_url: source.pinterest_url,
    pinterest_pin_id: source.pinterest_pin_id,
    author_name: source.author_name,
    author_url: source.author_url,
    attribution_note: source.attribution_note,
    image_url: source.image_url,
    source_image_url: source.source_image_url,
    difficulty: source.difficulty,
    estimated_time: source.estimated_time,
    bundle_price: source.bundle_price,
    bundle_discount_pct: source.bundle_discount_pct,
    tags: source.tags,
    display_order: source.display_order,
    is_active: false,
    is_featured: false,
  };

  const { data: created, error } = await admin.from('makes').insert(payload).select('id').single();

  if (error) {
    return redirect(
      withFlash(
        back,
        'error',
        isUniqueViolation(error)
          ? `Something else claimed the slug “${slug}” first — try again.`
          : `Could not duplicate: ${error.message}`,
      ),
    );
  }

  const target = `/pos/makes/${created.id}`;

  if (items.length) {
    const rows: MakeItemInsert[] = items.map((item) => ({ ...item, make_id: created.id }));
    const { error: itemError } = await admin.from('make_items').insert(rows);
    if (itemError) {
      return redirect(
        withFlash(
          target,
          'error',
          `Copied “${source.title}”, but the bundle did not come with it: ${itemError.message}`,
        ),
      );
    }
  }

  const count = items.length;
  const bundleNote = count
    ? ` Its bundle of ${count} item${count === 1 ? '' : 's'} came too.`
    : '';

  return redirect(
    withFlash(target, 'ok', `Copied “${source.title}”.${bundleNote} This one is a draft.`),
  );
};
