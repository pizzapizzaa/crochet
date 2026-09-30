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
import type { Difficulty, MakeInsert, MakeItemInsert, MakeKind } from '../../../lib/database.types';

/*
 * Create or update a kit — a make or a bundle — and its items in one submit.
 *
 * A make is somebody else's design, so it cannot be saved without the link to
 * it and the name of whoever made it. A bundle is the shop's own and has
 * neither. Everything else is the same.
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
  can_opt_out: boolean;
  display_order: number;
}

/** Zip the parallel arrays back into rows, dropping any with no product picked. */
function parseItems(form: FormData): { items: ParsedItem[]; duplicate: boolean } {
  const ids = all(form, 'item_product_id');
  const quantities = all(form, 'item_quantity');
  const notes = all(form, 'item_note');
  const skippable = all(form, 'item_can_skip');

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
      can_opt_out: skippable[i] === 'yes',
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
  const kind: MakeKind = str(form, 'kind') === 'bundle' ? 'bundle' : 'make';
  const noun = kind === 'bundle' ? 'bundle' : 'make';
  const back = safeNext(form, isEdit ? `/pos/makes/${id}` : `/pos/makes/new${kind === 'bundle' ? '?kind=bundle' : ''}`);

  const admin = getSupabaseAdmin();
  if (!admin) {
    return redirect(
      withFlash(back, 'error', 'Supabase is not connected — set SUPABASE_SERVICE_ROLE_KEY in .env.'),
    );
  }

  const title = str(form, 'title');
  const pinterestUrlRaw = str(form, 'pinterest_url');
  const authorName = str(form, 'author_name');

  if (!title) return redirect(withFlash(back, 'error', `Give the ${noun} a title.`));

  let pinterestUrl: string | null = null;
  if (kind === 'make') {
    if (!pinterestUrlRaw) {
      return redirect(withFlash(back, 'error', 'A make needs the link to the design it came from.'));
    }
    // A pin is tidied to its canonical address; any other design page is kept
    // as given, as long as it is a web address someone can follow.
    if (isPinterestUrl(pinterestUrlRaw)) {
      pinterestUrl = canonicalPinUrl(pinterestUrlRaw);
    } else if (/^https?:\/\/[^\s]+\.[^\s]+/i.test(pinterestUrlRaw)) {
      pinterestUrl = pinterestUrlRaw;
    } else {
      return redirect(withFlash(back, 'error', 'That link is not a web address — paste the pin or pattern page.'));
    }
    // Attribution is the whole point of storing the source, so it is required
    // here and not just encouraged. If the scrape found no name, the shop owner
    // types one in — "unknown" is a choice they make deliberately.
    if (!authorName) {
      return redirect(withFlash(back, 'error', 'Credit whoever made the design — that is what the source field is for.'));
    }
  }

  const slug = slugify(str(form, 'slug') || title);
  if (!slug) {
    return redirect(
      withFlash(back, 'error', 'That title produces an empty URL slug — add some letters or numbers.'),
    );
  }

  const bundlePrice = nullableNum(form, 'bundle_price');
  if (bundlePrice !== null && bundlePrice < 0) {
    return redirect(withFlash(back, 'error', 'The kit price cannot be negative.'));
  }

  const discount = num(form, 'bundle_discount_pct', 0);
  if (discount < 0 || discount >= 100) {
    return redirect(withFlash(back, 'error', 'The kit discount must be between 0 and 99.9%.'));
  }

  const completedAvailable = bool(form, 'completed_available');
  const completedPrice = nullableNum(form, 'completed_price');
  if (completedPrice !== null && completedPrice <= 0) {
    return redirect(withFlash(back, 'error', 'The completed price must be more than zero, or left blank.'));
  }
  if (completedAvailable && completedPrice === null) {
    return redirect(
      withFlash(back, 'error', 'Set a completed price, or untick “Available as complete product”.'),
    );
  }

  const difficultyRaw = str(form, 'difficulty');
  const difficulty = DIFFICULTIES.includes(difficultyRaw) ? (difficultyRaw as Difficulty) : null;

  const isMake = kind === 'make';
  const payload: MakeInsert = {
    kind,
    title,
    slug,
    summary: nullableStr(form, 'summary'),
    pinterest_url: pinterestUrl,
    pinterest_pin_id: pinterestUrl && isPinterestUrl(pinterestUrl) ? pinIdFrom(pinterestUrl) : null,
    author_name: isMake ? authorName : null,
    author_url: isMake ? nullableStr(form, 'author_url') : null,
    attribution_note: isMake ? nullableStr(form, 'attribution_note') : null,
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
    completed_available: completedAvailable,
    completed_price: completedPrice,
  };

  const { items, duplicate } = parseItems(form);
  const dupeNote = duplicate
    ? ' One product was listed twice — the duplicate was dropped, raise the quantity instead.'
    : '';

  const write = (row: MakeInsert) =>
    isEdit
      ? admin.from('makes').update(row).eq('id', id).select('id').single()
      : admin.from('makes').insert(row).select('id').single();

  let { data: saved, error } = await write(payload);

  /*
   * Before supabase/completed-schema.sql has been run the two completed
   * columns do not exist, and every save would fail on them. A kit that is
   * not being offered completed is saved without them, so the POS keeps
   * working in the gap; one that is gets told what to run.
   */
  if (error && /completed_(available|price)/.test(error.message)) {
    if (completedAvailable || completedPrice !== null) {
      return redirect(
        withFlash(
          back,
          'error',
          'Selling completed products needs a database update first: run supabase/completed-schema.sql in the Supabase SQL editor, then save again.',
        ),
      );
    }
    const { completed_available: _available, completed_price: _price, ...withoutCompleted } = payload;
    ({ data: saved, error } = await write(withoutCompleted));
  }

  if (error || !saved) {
    return redirect(
      withFlash(
        back,
        'error',
        error && isUniqueViolation(error)
          ? `Another make or bundle already uses the slug “${slug}”.`
          : `Could not ${isEdit ? 'save' : 'create'}: ${error?.message ?? 'nothing came back from the database'}`,
      ),
    );
  }

  const targetId = saved.id;

  const itemError = await replaceItems(admin, targetId, items);
  if (itemError) {
    return redirect(
      withFlash(
        `/pos/makes/${targetId}`,
        'error',
        `Saved “${title}”, but its items did not stick: ${itemError}`,
      ),
    );
  }

  const count = items.length;
  const skip = items.filter((i) => i.can_opt_out).length;
  const bundleNote = count
    ? ` The kit has ${count} item${count === 1 ? '' : 's'}${skip ? `, ${skip} of them skippable` : ''}.`
    : ' No materials in the kit yet — add some so the shop has something to sell.';

  if (isEdit) {
    return redirect(withFlash(back, 'ok', `Saved “${title}”.${bundleNote}${dupeNote}`));
  }
  return redirect(
    withFlash(`/pos/makes/${targetId}`, 'ok', `Created “${title}”.${bundleNote}${dupeNote}`),
  );
};
