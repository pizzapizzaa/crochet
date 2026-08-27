/*
 * What to show when there is no photograph.
 *
 * Every product image in the shop goes through here. The old fallback pointed
 * at /placeholder-product.jpg, which was never in public/ — so anything without
 * a photo of its own rendered the browser's broken-image glyph, which reads as
 * "this site is broken" rather than "no picture yet".
 */

/** A wound ball of yarn on a cream tile. See public/assets/placeholder-yarn.svg. */
export const NO_PHOTO = '/assets/placeholder-yarn.svg';

/** The first usable photo, or the stand-in. Treats '' and null alike. */
export function productImage(src?: string | null): string {
  return src?.trim() ? src : NO_PHOTO;
}

/*
 * A missing image is not the only way to get a broken tile: a Supabase URL can
 * 404 after a file is deleted, and no server-side check catches that. This
 * swaps in the placeholder when the load actually fails.
 *
 * `this.onerror = null` first — without it, a placeholder that ever failed to
 * load would re-fire the handler against itself forever.
 */
export const ON_IMG_ERROR = `this.onerror=null;this.src='${NO_PHOTO}'`;
