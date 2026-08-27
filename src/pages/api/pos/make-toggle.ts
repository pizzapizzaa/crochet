export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { safeNext, str, withFlash } from '../../../lib/posForms';

/** Flip a single boolean from the makes list without opening the editor. */
const TOGGLEABLE = ['is_active', 'is_featured'] as const;
type Toggleable = (typeof TOGGLEABLE)[number];

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const field = str(form, 'field') as Toggleable;
  const value = str(form, 'value') === 'true';
  const back = safeNext(form, '/pos/makes');

  if (!TOGGLEABLE.includes(field)) {
    return redirect(withFlash(back, 'error', 'That field cannot be toggled.'));
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(withFlash(back, 'error', 'Supabase is not connected.'));
  }

  const { error } = await admin
    .from('makes')
    .update({ [field]: value })
    .eq('id', id);

  if (error) {
    return redirect(withFlash(back, 'error', `Could not update: ${error.message}`));
  }

  const wording =
    field === 'is_active'
      ? value
        ? 'Published to the shop.'
        : 'Moved back to drafts.'
      : value
        ? 'Marked as featured.'
        : 'No longer featured.';

  return redirect(withFlash(back, 'ok', wording));
};
