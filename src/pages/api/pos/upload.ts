export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { slugify } from '../../../lib/posForms';

const BUCKET = 'product-images';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

const fail = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Pushes one image into the public `product-images` bucket and hands back its
 * URL, which the product form appends to the images list. Called by fetch()
 * from ProductForm, so it answers in JSON rather than redirecting.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (guardApi(cookies)) return fail('Not signed in.', 401);

  const admin = getSupabaseAdmin();
  if (!admin) return fail('Supabase is not connected.', 500);

  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) return fail('No file was sent.', 400);
  if (!ALLOWED.includes(file.type)) return fail('Use a JPEG, PNG, WebP, AVIF or GIF.', 415);
  if (file.size > MAX_BYTES) return fail('Images must be 5MB or smaller.', 413);

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'image';
  // crypto.randomUUID keeps re-uploads of the same filename from colliding.
  const path = `${base}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    const hint = /not found/i.test(error.message)
      ? ' Run supabase/pos-schema.sql — it creates the product-images bucket.'
      : '';
    return fail(`Upload failed: ${error.message}.${hint}`, 500);
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(BUCKET).getPublicUrl(path);

  return new Response(JSON.stringify({ url: publicUrl, path }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
