export const prerender = false;

import type { APIRoute } from 'astro';
import { authorizeImport, jsonFor, preflight } from '../../../lib/apiAuth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { copySlug, slugify } from '../../../lib/posForms';
import { mirrorImages } from '../../../lib/mirror';
import { draftFromBrowser, scrapeProduct, tidySourceUrl } from '../../../lib/scrape/product';
import type { ProductDraft } from '../../../lib/scrape/product';
import type { ProductInsert } from '../../../lib/database.types';

/*
 * Turns a scraped listing into a product on our shelf.
 *
 * One endpoint serves both front doors: the POS import screen, which sends
 * fields a human has just reviewed, and the browser extension, which sends
 * what it read off the rendered page. Either way the same rules apply here,
 * because the extension is running on a website we do not control and its
 * payload is no more trustworthy than any other request off the internet.
 *
 * Imports land as drafts unless asked otherwise, keep the source URL in
 * `supplier_url` so provenance survives, and hold their own copy of every
 * photograph rather than hotlinking the shop we got them from.
 */

/** The holding pen for one-click imports that did not name a category. */
const FALLBACK_CATEGORY = 'Imported';

export const OPTIONS: APIRoute = ({ request }) => preflight(request);

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown, max: number): string | null => {
  const out = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return out ? out.slice(0, max) : null;
};

/**
 * A hidden category to file one-click imports under. Hidden, not live: an
 * import that nobody has categorised should not invent a new aisle in the
 * shop's navigation on its way in.
 */
async function fallbackCategory(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
): Promise<{ id: string; name: string } | null> {
  const slug = slugify(FALLBACK_CATEGORY);

  const { data: existing } = await admin
    .from('categories')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle();
  if (existing) return existing;

  const { data } = await admin
    .from('categories')
    .insert({
      name: FALLBACK_CATEGORY,
      slug,
      description: 'Products brought in from another shop and not yet filed.',
      display_order: 999,
      is_active: false,
    })
    .select('id, name')
    .single();

  return data ?? null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  // Body first: the token may be in it, which is how the extension gets to
  // send a request no preflight stands in front of.
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonFor(request, { error: 'Invalid request body.' }, 400);
  }

  const { caller, denied } = authorizeImport(request, cookies, body.token);
  if (denied) return denied;

  const admin = getSupabaseAdmin();
  if (!admin) {
    return jsonFor(
      request,
      { error: 'Supabase is not connected — set SUPABASE_SERVICE_ROLE_KEY in the environment.' },
      500,
    );
  }

  /*
   * Three ways in, in order of how much the caller has already done:
   * reviewed fields, a page the browser read, or just a link for us to fetch.
   */
  let draft: ProductDraft | null = null;
  let scrapeNote: string | null = null;

  if (body.browser && typeof body.browser === 'object') {
    draft = draftFromBrowser(body.browser as Record<string, unknown>);
  } else if (!body.name && body.url) {
    const outcome = await scrapeProduct(String(body.url));
    draft = outcome.draft;
    scrapeNote = outcome.note;
  }

  const sourceUrl = tidySourceUrl(text(body.url, 1000) ?? draft?.sourceUrl ?? '');
  const siteName = text(body.siteName, 80) ?? draft?.siteName ?? null;

  const name = text(body.name, 140) ?? draft?.name ?? null;
  if (!name) {
    return jsonFor(
      request,
      { error: scrapeNote ?? 'Could not work out a product name — send one, or import it by hand.' },
      422,
    );
  }

  const price = num(body.price) ?? draft?.price ?? null;
  if (price === null || price < 0) {
    return jsonFor(
      request,
      { error: 'No usable price. Type one in, or set a markup so one can be worked out.' },
      422,
    );
  }

  // A duplicate is the likeliest mistake in a one-click tool: the button is
  // easy to press twice, and two pages of the same shop can share a URL.
  if (sourceUrl && body.allowDuplicate !== true) {
    const { data: already } = await admin
      .from('products')
      .select('id, name')
      .eq('supplier_url', sourceUrl)
      .limit(1)
      .maybeSingle();
    if (already) {
      return jsonFor(request, {
        duplicate: true,
        id: already.id,
        name: already.name,
        editUrl: `/pos/products/${already.id}`,
        note: `“${already.name}” was already imported from that link.`,
      });
    }
  }

  // Category: what was chosen, or the hidden holding pen.
  let categoryId = text(body.categoryId, 60);
  let categoryName: string | null = null;
  if (categoryId) {
    const { data: category } = await admin
      .from('categories')
      .select('id, name')
      .eq('id', categoryId)
      .maybeSingle();
    if (!category) return jsonFor(request, { error: 'That category no longer exists.' }, 422);
    categoryName = category.name;
  } else {
    const fallback = await fallbackCategory(admin);
    if (!fallback) {
      return jsonFor(
        request,
        { error: 'No category was given and the Imported category could not be created.' },
        500,
      );
    }
    categoryId = fallback.id;
    categoryName = fallback.name;
  }

  const sourceImages = Array.isArray(body.images)
    ? (body.images as unknown[]).map((i) => text(i, 1000)).filter((i): i is string => Boolean(i))
    : (draft?.images ?? []);

  // Our own copy, not a hotlink: shops rotate their CDN paths and plenty of
  // them refuse to serve an image to a page that is not theirs.
  const { urls: images, mirrored } =
    body.mirrorImages === false
      ? { urls: sourceImages.slice(0, 6), mirrored: 0 }
      : await mirrorImages(admin, sourceImages, {
          folder: 'imports',
          nameHint: name,
          referer: sourceUrl || undefined,
          limit: 6,
        });

  const description =
    text(body.description, 4000) ??
    draft?.description ??
    `Imported from ${siteName ?? 'another shop'}. Description still to be written.`;

  const slugStem = slugify(text(body.slug, 80) ?? name);
  if (!slugStem) {
    return jsonFor(request, { error: 'That name produces an empty URL slug.' }, 422);
  }
  const { data: slugRows } = await admin.from('products').select('slug');
  const slug = copySlug(slugStem, (slugRows ?? []).map((r) => r.slug));

  const currency = text(body.currency, 3) ?? draft?.currency ?? null;
  const costPrice = num(body.costPrice);
  const compareAt = num(body.compareAtPrice) ?? draft?.compareAtPrice ?? null;

  const noteParts = [
    `Imported from ${siteName ?? 'another shop'} on ${new Date().toISOString().slice(0, 10)}.`,
    // The shop prices in USD and has no currency column, so a foreign price is
    // recorded as a number plus this warning rather than silently converted.
    currency && currency !== 'USD' ? `Source price was in ${currency} — convert before trusting it.` : null,
    text(body.costNote, 200),
  ].filter(Boolean);

  const payload: ProductInsert = {
    name,
    slug,
    description,
    price,
    compare_at_price: compareAt !== null && compareAt > price ? compareAt : null,
    category: categoryName!,
    category_id: categoryId!,
    tags: Array.isArray(body.tags)
      ? (body.tags as unknown[]).map((t) => text(t, 40)).filter((t): t is string => Boolean(t)).slice(0, 15)
      : (draft?.tags ?? []),
    images,
    stock: Math.max(0, Math.round(num(body.stock) ?? 0)),
    is_active: body.publish === true,
    is_featured: false,
    cost_price: costPrice !== null && costPrice >= 0 ? costPrice : null,
    supplier_name: siteName,
    supplier_url: sourceUrl || null,
    supplier_sku: text(body.sku, 60) ?? draft?.sku ?? null,
    cost_note: noteParts.join(' ').slice(0, 500),
  };

  const { data, error } = await admin.from('products').insert(payload).select('id').single();
  if (error) {
    return jsonFor(request, { error: `Could not save: ${error.message}` }, 500);
  }

  const warnings = [
    images.length === 0 ? 'No photograph came across — add one before publishing.' : null,
    images.length > 0 && mirrored === 0
      ? 'The photographs are still hotlinked to the source shop; upload copies if they stop loading.'
      : null,
    text(body.description, 4000) === null && !draft?.description
      ? 'No description was found — write one before publishing.'
      : null,
    currency && currency !== 'USD' ? `The source price was in ${currency}, not USD.` : null,
    categoryName === FALLBACK_CATEGORY ? 'Filed under the hidden “Imported” category.' : null,
  ].filter((w): w is string => Boolean(w));

  return jsonFor(request, {
    id: data.id,
    name,
    slug,
    editUrl: `/pos/products/${data.id}`,
    published: body.publish === true,
    imagesMirrored: mirrored,
    imageCount: images.length,
    category: categoryName,
    via: caller,
    warnings,
  });
};
