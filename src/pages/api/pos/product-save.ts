export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import {
  bool,
  csv,
  isUniqueViolation,
  lines,
  nullableNum,
  nullableStr,
  num,
  safeNext,
  slugify,
  str,
  withFlash,
} from '../../../lib/posForms';
import type { ProductInsert } from '../../../lib/database.types';

/** Create when no `id` came through, update otherwise. */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const isEdit = id !== '';
  const back = safeNext(form, isEdit ? `/pos/products/${id}` : '/pos/products/new');

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(
      withFlash(back, 'error', 'Supabase is not connected — set SUPABASE_SERVICE_ROLE_KEY in .env.'),
    );
  }

  const name = str(form, 'name');
  const description = str(form, 'description');
  const categoryId = str(form, 'category_id');
  const price = num(form, 'price', NaN);

  if (!name) return redirect(withFlash(back, 'error', 'A product needs a name.'));
  if (!description) return redirect(withFlash(back, 'error', 'A product needs a description.'));
  if (!categoryId) return redirect(withFlash(back, 'error', 'Pick a category for this product.'));
  if (!Number.isFinite(price) || price < 0) {
    return redirect(withFlash(back, 'error', 'Price must be a number of zero or more.'));
  }

  const compareAt = nullableNum(form, 'compare_at_price');
  if (compareAt !== null && compareAt < 0) {
    return redirect(withFlash(back, 'error', 'Compare-at price cannot be negative.'));
  }

  const stock = Math.max(0, Math.round(num(form, 'stock', 0)));
  const slug = slugify(str(form, 'slug') || name);
  if (!slug) {
    return redirect(withFlash(back, 'error', 'That name produces an empty URL slug — add some letters or numbers.'));
  }

  // The category's name is mirrored onto products.category by a DB trigger, so
  // it only needs a placeholder here to satisfy the NOT NULL column on insert.
  const { data: category } = await admin
    .from('categories')
    .select('name')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) {
    return redirect(withFlash(back, 'error', 'That category no longer exists. Pick another.'));
  }

  const payload: ProductInsert = {
    name,
    slug,
    description,
    price,
    compare_at_price: compareAt,
    category: category.name,
    category_id: categoryId,
    tags: csv(form, 'tags'),
    images: lines(form, 'images'),
    stock,
    is_active: bool(form, 'is_active'),
    is_featured: bool(form, 'is_featured'),
    yarn_weight: nullableStr(form, 'yarn_weight'),
    hook_size: nullableStr(form, 'hook_size'),
    dimensions: nullableStr(form, 'dimensions'),
    care_instructions: nullableStr(form, 'care_instructions'),
  };

  if (isEdit) {
    const { error } = await admin.from('products').update(payload).eq('id', id);
    if (error) {
      return redirect(
        withFlash(
          back,
          'error',
          isUniqueViolation(error)
            ? `Another product already uses the slug “${slug}”.`
            : `Could not save: ${error.message}`,
        ),
      );
    }
    return redirect(withFlash(back, 'ok', `Saved “${name}”.`));
  }

  const { data, error } = await admin.from('products').insert(payload).select('id').single();
  if (error) {
    return redirect(
      withFlash(
        back,
        'error',
        isUniqueViolation(error)
          ? `Another product already uses the slug “${slug}”.`
          : `Could not create: ${error.message}`,
      ),
    );
  }

  return redirect(withFlash(`/pos/products/${data.id}`, 'ok', `Created “${name}”.`));
};
