export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { copySlug, slugify } from '../../../lib/posForms';
import { mirrorImage } from '../../../lib/mirror';
import { canonicalPinUrl, isPinterestUrl, pinIdFrom, upgradePinImage } from '../../../lib/pinterest';
import { DIFFICULTIES, type Difficulty, type MakeInsert } from '../../../lib/database.types';

/*
 * The writing half of the bulk pin importer.
 *
 * Called once per batch of reviewed rows. Each one becomes a make with no
 * bundle attached — a make is only worth selling once somebody has picked the
 * yarn and the hooks for it, and guessing that from a photograph is not
 * something this can do. So imports land as drafts by default and the shop
 * owner opens each one to build its bundle.
 *
 * Two things are enforced here rather than trusted from the client: the pin
 * link has to be a Pinterest link, and the author has to be named. Both are
 * NOT NULL in the schema because credit travelling with the make is the whole
 * reason the source is stored, and a bulk tool is exactly where that would
 * otherwise get skipped a hundred times in one go.
 */

const BATCH_LIMIT = 25;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

interface IncomingItem {
  url?: unknown;
  title?: unknown;
  summary?: unknown;
  authorName?: unknown;
  authorUrl?: unknown;
  imageUrl?: unknown;
  difficulty?: unknown;
  tags?: unknown;
}

export interface ImportResult {
  url: string;
  ok: boolean;
  id: string | null;
  slug: string | null;
  title: string;
  /** Whether we ended up holding our own copy of the pin image. */
  mirrored: boolean;
  error: string | null;
}

const text = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max);

export const POST: APIRoute = async ({ request, cookies }) => {
  if (guardApi(cookies)) return json({ error: 'Not signed in.' }, 401);

  const admin = getSupabaseAdmin();
  if (!admin) {
    return json(
      { error: 'Supabase is not connected — set SUPABASE_SERVICE_ROLE_KEY in your environment.' },
      500,
    );
  }

  let items: IncomingItem[] = [];
  let publish = false;
  try {
    const body = await request.json();
    items = Array.isArray(body?.items) ? body.items : [];
    publish = body?.publish === true;
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  items = items.slice(0, BATCH_LIMIT);
  if (items.length === 0) return json({ results: [] });

  // Every slug in use, so the batch can pick free ones without a round trip
  // per row — and so two rows in the same batch cannot claim the same slug.
  const { data: slugRows } = await admin.from('makes').select('slug');
  const taken = new Set((slugRows ?? []).map((r) => r.slug));

  // Where the display_order counter has got to, so imports queue up after
  // whatever is already on the makes page instead of all landing at zero.
  const { data: lastOrder } = await admin
    .from('makes')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrder = (lastOrder?.display_order ?? 0) + 1;

  const results: ImportResult[] = [];

  // Sequential on purpose: each row mirrors an image and claims a slug, and
  // both of those are cheaper to reason about one at a time than to unpick
  // after a race.
  for (const item of items) {
    const rawUrl = text(item.url, 500);
    const title = text(item.title, 140);
    const authorName = text(item.authorName, 120);

    const fail = (error: string): ImportResult => ({
      url: rawUrl,
      ok: false,
      id: null,
      slug: null,
      title: title || rawUrl,
      mirrored: false,
      error,
    });

    if (!rawUrl || !isPinterestUrl(rawUrl)) {
      results.push(fail('Not a Pinterest link.'));
      continue;
    }
    if (!title) {
      results.push(fail('Needs a title.'));
      continue;
    }
    if (!authorName) {
      results.push(fail('Needs the pin author — credit travels with the make.'));
      continue;
    }

    const url = canonicalPinUrl(rawUrl);
    const stem = slugify(title);
    if (!stem) {
      results.push(fail('That title produces an empty URL slug.'));
      continue;
    }
    const slug = copySlug(stem, taken);

    const sourceImageUrl = text(item.imageUrl, 1000) || null;
    let imageUrl = sourceImageUrl;
    let mirrored = false;
    if (sourceImageUrl) {
      const copy = await mirrorImage(admin, [upgradePinImage(sourceImageUrl), sourceImageUrl], {
        folder: 'makes',
        nameHint: title,
        referer: 'https://www.pinterest.com/',
      });
      if (copy) {
        imageUrl = copy;
        mirrored = true;
      }
    }

    const difficultyRaw = text(item.difficulty, 20);
    const difficulty = DIFFICULTIES.includes(difficultyRaw as Difficulty)
      ? (difficultyRaw as Difficulty)
      : null;

    const tags = Array.isArray(item.tags)
      ? item.tags.map((t) => text(t, 40)).filter(Boolean).slice(0, 12)
      : [];

    const payload: MakeInsert = {
      title,
      slug,
      summary: text(item.summary, 1000) || null,
      pinterest_url: url,
      pinterest_pin_id: pinIdFrom(url),
      author_name: authorName,
      author_url: text(item.authorUrl, 500) || null,
      image_url: imageUrl,
      source_image_url: sourceImageUrl,
      difficulty,
      tags,
      display_order: nextOrder,
      // Drafts unless asked otherwise: an imported make has no bundle yet, and
      // a make with nothing to sell has no business on the shop.
      is_active: publish,
      is_featured: false,
    };

    const { data, error } = await admin.from('makes').insert(payload).select('id').single();
    if (error) {
      results.push(fail(`Could not save: ${error.message}`));
      continue;
    }

    taken.add(slug);
    nextOrder += 1;
    results.push({ url, ok: true, id: data.id, slug, title, mirrored, error: null });
  }

  const created = results.filter((r) => r.ok).length;
  return json({ results, created, failed: results.length - created });
};
