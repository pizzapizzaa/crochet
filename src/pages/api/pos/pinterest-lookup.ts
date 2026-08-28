export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { mirrorImage } from '../../../lib/mirror';
import { isPinterestUrl, lookupPin, upgradePinImage } from '../../../lib/pinterest';

/*
 * Paste-a-link endpoint for the make editor. Reads the pin, then mirrors its
 * image into our own bucket — Pinterest rotates CDN paths and blocks hotlinks
 * from some referrers, so a pin image we do not hold a copy of is a broken
 * product photo waiting to happen.
 *
 * Answers in JSON: the POS calls it with fetch() and fills the form in place.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

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
    // Full-resolution path first, the preview Pinterest advertised second.
    mirroredUrl = await mirrorImage(admin, [upgradePinImage(pin.imageUrl), pin.imageUrl], {
      folder: 'makes',
      nameHint: pin.title ?? pin.pinId ?? 'pin',
      referer: 'https://www.pinterest.com/',
    });
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
