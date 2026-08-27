export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { copySlug, isUniqueViolation, safeNext, slugify, str, withFlash } from '../../../lib/posForms';
import type { Product, ProductInsert } from '../../../lib/database.types';

/*
 * Copy a product into a fresh draft and open it.
 *
 * The catalogue fields come across untouched — a duplicate is usually the same
 * thing in another colour — but anything that counts real-world units starts
 * over. The copy has never been published, never been featured, and none of it
 * is on a shelf yet, so stock and units_sold begin at zero. Costing carries
 * over: the same yarn from the same supplier still costs the same.
 */
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
    return redirect(withFlash(back, 'error', 'No product was named for duplication.'));
  }

  const { data, error: readError } = await admin
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (readError || !data) {
    return redirect(withFlash(back, 'error', 'That product no longer exists.'));
  }

  const source = data as Product;

  const stem = slugify(`${source.slug}-copy`);
  const { data: clashes } = await admin.from('products').select('slug').like('slug', `${stem}%`);
  const slug = copySlug(stem, (clashes ?? []).map((row) => row.slug));

  const payload: ProductInsert = {
    name: `${source.name} (copy)`,
    slug,
    description: source.description,
    price: source.price,
    compare_at_price: source.compare_at_price,
    category: source.category,
    category_id: source.category_id,
    tags: source.tags,
    images: source.images,
    stock: 0,
    is_active: false,
    is_featured: false,
    yarn_weight: source.yarn_weight,
    hook_size: source.hook_size,
    dimensions: source.dimensions,
    care_instructions: source.care_instructions,
    cost_price: source.cost_price,
    supplier_name: source.supplier_name,
    supplier_url: source.supplier_url,
    supplier_sku: source.supplier_sku,
    cost_note: source.cost_note,
    cost_updated_at: source.cost_updated_at,
  };

  const { data: created, error } = await admin
    .from('products')
    .insert(payload)
    .select('id')
    .single();

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

  return redirect(
    withFlash(
      `/pos/products/${created.id}`,
      'ok',
      `Copied “${source.name}”. This one is a draft — rename it and set its stock, then publish.`,
    ),
  );
};
