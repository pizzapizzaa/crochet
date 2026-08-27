export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import {
  all,
  bool,
  csv,
  isUniqueViolation,
  nullableNum,
  nullableStr,
  num,
  safeNext,
  slugify,
  str,
  withFlash,
} from '../../../lib/posForms';
import { canonicalPinUrl, isPinterestUrl, pinIdFrom } from '../../../lib/pinterest';
import type { Difficulty, MakeInsert, MakeItemInsert } from '../../../lib/database.types';

/*
 * Create or update a make and its bundle in one submit.
 *
 * The bundle arrives as parallel arrays — item_product_id[], item_quantity[]
 * and so on, one entry per row of the editor. Every field is an <input> or a
 * <select> so the arrays always line up; a checkbox would drop out of the
 * submission when unticked and silently shift every row after it.
 */

const DIFFICULTIES = ['Beginner', 'Easy', 'Intermediate', 'Advanced'];

interface ParsedItem {
  product_id: string;
  quantity: number;
  note: string | null;
  is_optional: boolean;
  display_order: number;
}

/** Zip the parallel arrays back into rows, dropping any with no product picked. */
function parseItems(form: FormData): { items: ParsedItem[]; duplicate: boolean } {
  const ids = all(form, 'item_product_id');
  const quantities = all(form, 'item_quantity');
  const notes = all(form, 'item_note');
  const optionals = all(form, 'item_optional');

  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  let duplicate = false;

  ids.forEach((productId, i) => {
    if (!productId) return;
    if (seen.has(productId)) {
      duplicate = true;
      return;
    }
    seen.add(productId);

    const parsed = Number(quantities[i] ?? '1');
    items.push({
      product_id: productId,
      // Quantity is a multiplier on price, so a bad value must not become 0.
      quantity: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 1,
      note: (notes[i] ?? '').trim() || null,
      is_optional: optionals[i] === 'optional',
      display_order: items.length + 1,
    });
  });

  return { items, duplicate };
}

/** Wipe and rewrite the bundle. Fewer moving parts than diffing, same result. */
async function replaceItems(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  makeId: string,
  items: ParsedItem[],
): Promise<string | null> {
  const { error: clearError } = await admin.from('make_items').delete().eq('make_id', makeId);
  if (clearError) return clearError.message;
  if (items.length === 0) return null;

  const rows: MakeItemInsert[] = items.map((i) => ({ ...i, make_id: makeId }));
  const { error } = await admin.from('make_items').insert(rows);
  return error?.message ?? null;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const denied = guardApi(cookies);
  if (denied) return denied;

  const form = await request.formData();
  const id = str(form, 'id');
  const isEdit = id !== '';
  const back = safeNext(form, isEdit ? `/pos/makes/${id}` : '/pos/makes/new');

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(
      withFlash(back, 'error', 'Supabase is not connected — set SUPABASE_SERVICE_ROLE_KEY in .env.'),
    );
  }

  const title = str(form, 'title');
  const pinterestUrlRaw = str(form, 'pinterest_url');
  const authorName = str(form, 'author_name');

  if (!title) return redirect(withFlash(back, 'error', 'Give the make a title.'));
  if (!pinterestUrlRaw) {
    return redirect(withFlash(back, 'error', 'A make needs the Pinterest link it came from.'));
  }
  if (!isPinterestUrl(pinterestUrlRaw)) {
    return redirect(
      withFlash(back, 'error', 'That does not look like a Pinterest link — paste the pin URL.'),
    );
  }
  // Attribution is the whole point of storing the source, so it is required
  // here and not just encouraged. If the scrape found no name, the shop owner
  // types one in — "unknown" is a choice they make deliberately.
  if (!authorName) {
    return redirect(
      withFlash(back, 'error', 'Credit the pin author — that is what the source field is for.'),
    );
  }

  const slug = slugify(str(form, 'slug') || title);
  if (!slug) {
    return redirect(
      withFlash(back, 'error', 'That title produces an empty URL slug — add some letters or numbers.'),
    );
  }

  const bundlePrice = nullableNum(form, 'bundle_price');
  if (bundlePrice !== null && bundlePrice < 0) {
    return redirect(withFlash(back, 'error', 'Bundle price cannot be negative.'));
  }

  const discount = num(form, 'bundle_discount_pct', 0);
  if (discount < 0 || discount >= 100) {
    return redirect(withFlash(back, 'error', 'Bundle discount must be between 0 and 99.9%.'));
  }

  const difficultyRaw = str(form, 'difficulty');
  const difficulty = DIFFICULTIES.includes(difficultyRaw) ? (difficultyRaw as Difficulty) : null;

  const pinterestUrl = canonicalPinUrl(pinterestUrlRaw);

  const payload: MakeInsert = {
    title,
    slug,
    summary: nullableStr(form, 'summary'),
    pinterest_url: pinterestUrl,
    pinterest_pin_id: pinIdFrom(pinterestUrl),
    author_name: authorName,
    author_url: nullableStr(form, 'author_url'),
    attribution_note: nullableStr(form, 'attribution_note'),
    image_url: nullableStr(form, 'image_url'),
    source_image_url: nullableStr(form, 'source_image_url'),
    difficulty,
    estimated_time: nullableStr(form, 'estimated_time'),
    bundle_price: bundlePrice,
    bundle_discount_pct: discount,
    tags: csv(form, 'tags'),
    display_order: Math.round(num(form, 'display_order', 0)),
    is_active: bool(form, 'is_active'),
    is_featured: bool(form, 'is_featured'),
  };

  const { items, duplicate } = parseItems(form);
  const dupeNote = duplicate
    ? ' One product was listed twice — the duplicate was dropped, raise the quantity instead.'
    : '';

  const makeId = isEdit ? id : null;

  if (isEdit) {
    const { error } = await admin.from('makes').update(payload).eq('id', id);
    if (error) {
      return redirect(
        withFlash(
          back,
          'error',
          isUniqueViolation(error)
            ? `Another make already uses the slug “${slug}”.`
            : `Could not save: ${error.message}`,
        ),
      );
    }
  }

  let targetId = makeId;
  if (!isEdit) {
    const { data, error } = await admin.from('makes').insert(payload).select('id').single();
    if (error) {
      return redirect(
        withFlash(
          back,
          'error',
          isUniqueViolation(error)
            ? `Another make already uses the slug “${slug}”.`
            : `Could not create: ${error.message}`,
        ),
      );
    }
    targetId = data.id;
  }

  const itemError = await replaceItems(admin, targetId!, items);
  if (itemError) {
    return redirect(
      withFlash(
        `/pos/makes/${targetId}`,
        'error',
        `Saved “${title}”, but the bundle did not stick: ${itemError}`,
      ),
    );
  }

  const count = items.length;
  const bundleNote = count
    ? ` Bundle has ${count} item${count === 1 ? '' : 's'}.`
    : ' No materials in the bundle yet — add some so the shop has something to sell.';

  if (isEdit) {
    return redirect(withFlash(back, 'ok', `Saved “${title}”.${bundleNote}${dupeNote}`));
  }
  return redirect(
    withFlash(`/pos/makes/${targetId}`, 'ok', `Created “${title}”.${bundleNote}${dupeNote}`),
  );
};
