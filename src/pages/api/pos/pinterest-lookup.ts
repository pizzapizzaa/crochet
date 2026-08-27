export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { slugify } from '../../../lib/posForms';
import { isPinterestUrl, lookupPin, upgradePinImage } from '../../../lib/pinterest';

/*
 * Paste-a-link endpoint for the make editor. Reads the pin, then mirrors its
 * image into our own bucket — Pinterest rotates CDN paths and blocks hotlinks
 * from some referrers, so a pin image we do not hold a copy of is a broken
 * product photo waiting to happen.
 *
 * Answers in JSON: the POS calls it with fetch() and fills the form in place.
 */

const BUCKET = 'product-images';
const MAX_BYTES = 8 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

/**
 * Pull the pin image down and put it in our bucket. Returns null on any
 * failure — the caller keeps the remote URL, which is degraded but not broken.
 */
async function mirrorImage(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  imageUrl: string,
  nameHint: string,
): Promise<string | null> {
  const candidates = [imageUrl];
  const original = upgradePinImage(imageUrl);
  // Try the full-resolution path first, then whatever we were handed.
  if (original !== imageUrl) candidates.unshift(original);

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: { Referer: 'https://www.pinterest.com/' },
      });
      if (!res.ok) continue;

      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      const ext = EXT_BY_TYPE[type];
      if (!ext) continue;

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) continue;

      const base = slugify(nameHint) || 'pin';
      const path = `makes/${base}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

      const { error } = await admin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: type, upsert: false });
      if (error) continue;

      return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (guardApi(cookies)) return json({ error: 'Not signed in.' }, 401);

  let url = '';
  try {
    const body = await request.json();
    url = String(body?.url ?? '').trim();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (!url) return json({ error: 'Paste a Pinterest link first.' }, 400);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!isPinterestUrl(url)) {
    return json({ error: 'That is not a Pinterest link. Copy the pin URL and try again.' }, 400);
  }

  const pin = await lookupPin(url);

  // Mirroring is optional: without Supabase the editor still gets the metadata
  // and can point at the remote image.
  const admin = getSupabaseAdmin();
  let mirroredUrl: string | null = null;
  if (admin && pin.imageUrl) {
    mirroredUrl = await mirrorImage(admin, pin.imageUrl, pin.title ?? pin.pinId ?? 'pin');
  }

  const found = Boolean(pin.imageUrl || pin.authorName || pin.title);

  return json({
    url: pin.url,
    pinId: pin.pinId,
    title: pin.title,
    description: pin.description,
    authorName: pin.authorName,
    authorUrl: pin.authorUrl,
    sourceImageUrl: pin.imageUrl,
    imageUrl: mirroredUrl ?? pin.imageUrl,
    mirrored: Boolean(mirroredUrl),
    via: pin.via,
    // The POS shows this verbatim, so it says what to do rather than what broke.
    note: found
      ? mirroredUrl
        ? null
        : pin.imageUrl
          ? 'Saved the link to the pin image but could not keep a copy — upload one if it stops loading.'
          : 'Found the pin but no image. Add one by hand below.'
      : 'Pinterest did not return anything for that link. Fill the title, image and author in by hand — the link itself is saved either way.',
  });
};
