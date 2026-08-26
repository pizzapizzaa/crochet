export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import {
  bool,
  isUniqueViolation,
  nullableStr,
  num,
  safeNext,
  slugify,
  str,
  withFlash,
} from '../../../lib/posForms';
import type { CategoryInsert } from '../../../lib/database.types';

/** Create when no `id` came through, update otherwise. */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const isEdit = id !== '';
  const back = safeNext(form, '/pos/categories');

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(
      withFlash(back, 'error', 'Supabase is not connected - set SUPABASE_SERVICE_ROLE_KEY in .env.'),
    );
  }

  const name = str(form, 'name');
  if (!name) return redirect(withFlash(back, 'error', 'A category needs a name.'));

  const slug = slugify(str(form, 'slug') || name);
  if (!slug) {
    return redirect(
      withFlash(back, 'error', 'That name produces an empty slug - add some letters or numbers.'),
    );
  }

  const payload: CategoryInsert = {
    name,
    slug,
    description: nullableStr(form, 'description'),
    display_order: Math.round(num(form, 'display_order', 0)),
    is_active: bool(form, 'is_active'),
  };

  if (isEdit) {
    const { error } = await admin.from('categories').update(payload).eq('id', id);
    if (error) {
      return redirect(
        withFlash(
          back,
          'error',
          isUniqueViolation(error)
            ? `Another category already uses the name or slug "${name}".`
            : `Could not save: ${error.message}`,
        ),
      );
    }
    // Renaming cascades onto every product in the category via a DB trigger.
    return redirect(withFlash(back, 'ok', `Saved "${name}".`));
  }

  const { error } = await admin.from('categories').insert(payload);
  if (error) {
    return redirect(
      withFlash(
        back,
        'error',
        isUniqueViolation(error)
          ? `A category called "${name}" already exists.`
          : `Could not create: ${error.message}`,
      ),
    );
  }

  return redirect(withFlash(back, 'ok', `Added "${name}".`));
};
