import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { slugify } from './posForms';
import { isFetchableUrl } from './scrape/html';

/*
 * Keeping our own copy of a picture we found somewhere else.
 *
 * Both importers hit the same problem: the image that comes back from a
 * Pinterest pin or a supplier's product page lives on a CDN we do not control.
 * Pinterest rotates its paths, shops re-issue theirs on every redeploy, and
 * plenty of both refuse to serve a hotlink once the referrer is not their own
 * site. A catalogue full of remote URLs is a catalogue of images that will go
 * blank at some point without anybody touching the database.
 *
 * So every import pulls the bytes down once and puts them in the same public
 * `product-images` bucket the uploader writes to. Failure is not fatal: the
 * caller keeps the remote URL, which is degraded but still shows a picture.
 */

const BUCKET = 'product-images';

/** Big enough for a full-resolution product photo, small enough to not stall. */
const MAX_BYTES = 8 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 15000;

/** Only formats a browser will render, keyed by the extension we save under. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

export type Admin = SupabaseClient<Database>;

export interface MirrorOptions {
  /** Folder inside the bucket: 'makes' for pins, 'imports' for shop products. */
  folder?: string;
  /** Names the saved file, so the bucket stays readable. */
  nameHint?: string;
  /**
   * Sent as the Referer. A shop that blocks hotlinking usually still serves
   * its own pages, so claiming to be one gets the bytes.
   */
  referer?: string;
}

/**
 * A data: URI is already the bytes — some sites inline their main photo, and
 * storing the URI itself would put megabytes in a text column.
 *
 * It goes through the same two gates as anything fetched: it must declare a
 * type we are willing to serve, and it must be small. Skipping those here
 * would be the whole point of them — the URI's own Content-Type is written
 * onto the object in a public bucket, so "data:text/html" arriving from a
 * scraped page and being served back as a page is exactly what this refuses.
 */
function decodeDataUri(uri: string): { bytes: Uint8Array; type: string } | null {
  const match = uri.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) return null;
  const [, rawType, base64, payload] = match;
  const type = rawType.trim().toLowerCase();
  if (!EXT_BY_TYPE[type]) return null;

  try {
    let bytes: Uint8Array;
    if (base64) {
      const binary = atob(payload);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    return { bytes, type };
  } catch {
    return null;
  }
}

async function fetchBytes(
  url: string,
  referer: string | undefined,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (url.startsWith('data:')) return decodeDataUri(url);

  // Same reasoning as the page scraper: an image URL is caller-supplied, and
  // "fetch this picture" pointed at a private address is a probe, not a photo.
  if (!isFetchableUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        ...(referer ? { Referer: referer } : {}),
      },
    });
    if (!res.ok) return null;
    // redirect: 'follow' means the URL we checked is not necessarily the URL
    // we fetched. A hop into a private address is refused at the far end too.
    if (res.url && !isFetchableUrl(res.url)) return null;

    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!EXT_BY_TYPE[type]) return null;

    // Trust the header when it is there, so an oversized file is refused
    // before we spend the bandwidth reading it.
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    return { bytes, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Copy one remote image into our bucket and return its public URL, or null if
 * anything at all went wrong. Never throws — an import that loses a photo is
 * still an import worth finishing.
 *
 * `candidates` are tried in order, which is how the Pinterest importer asks for
 * the full-resolution file first and settles for the preview.
 */
export async function mirrorImage(
  admin: Admin,
  candidates: string | string[],
  options: MirrorOptions = {},
): Promise<string | null> {
  const { folder = 'imports', nameHint = 'image', referer } = options;
  const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);

  for (const candidate of list) {
    const fetched = await fetchBytes(candidate, referer);
    if (!fetched) continue;

    const ext = EXT_BY_TYPE[fetched.type];
    // Both routes into fetchBytes check this already; a third check costs
    // nothing and means no future one can put "photo.undefined" in the bucket.
    if (!ext) continue;
    const base = slugify(nameHint).slice(0, 48) || 'image';
    // The random suffix keeps two imports of the same product from colliding.
    const path = `${folder}/${base}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    const { error } = await admin.storage
      .from(BUCKET)
      .upload(path, fetched.bytes, { contentType: fetched.type, upsert: false });
    if (error) continue;

    return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  return null;
}

/**
 * Mirror a handful of images, keeping the order they arrived in. Anything that
 * fails falls back to its remote URL rather than leaving a hole in the list.
 *
 * `limit` exists because a product page can advertise thirty photographs and
 * the shop only ever shows the first few.
 */
export async function mirrorImages(
  admin: Admin,
  urls: string[],
  options: MirrorOptions & { limit?: number } = {},
): Promise<{ urls: string[]; mirrored: number }> {
  const { limit = 6, ...rest } = options;
  const wanted = urls.filter(Boolean).slice(0, limit);

  const settled = await Promise.all(
    wanted.map(async (url, i) => {
      const copy = await mirrorImage(admin, url, {
        ...rest,
        nameHint: i === 0 ? (rest.nameHint ?? 'image') : `${rest.nameHint ?? 'image'}-${i + 1}`,
      });
      return { url: copy ?? url, mirrored: copy !== null };
    }),
  );

  return {
    urls: settled.map((s) => s.url),
    mirrored: settled.filter((s) => s.mirrored).length,
  };
}
