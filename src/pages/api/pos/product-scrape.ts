export const prerender = false;

import type { APIRoute } from 'astro';
import { authorizeImport, jsonFor, preflight } from '../../../lib/apiAuth';
import { formatSource, normaliseCode, toUsd } from '../../../lib/currency';
import { draftFromBrowser, scrapeProduct } from '../../../lib/scrape/product';
import type { ProductDraft } from '../../../lib/scrape/product';

/*
 * "Here is a shop link — what is on it?"
 *
 * Read-only: it writes nothing and mirrors nothing, so it is safe to call from
 * a preview box while somebody is still deciding. Both importers use it — the
 * POS screen sends a URL for the server to fetch, and the extension sends what
 * Chrome already rendered, which is the only thing that works on shops that
 * refuse a plain server request.
 */

export const OPTIONS: APIRoute = ({ request }) => preflight(request);

/*
 * What the price becomes in USD, worked out here rather than in each importer.
 *
 * The screen and the extension both need the converted figure and they must
 * agree on it. Doing it once on the server is what guarantees that; it also
 * means the rate lives in one file instead of being restated in extension
 * JavaScript that updates on a different schedule to the site.
 *
 * Null when there is nothing to convert — an already-USD price, or no price at
 * all. `unconvertible` is the third case, and the interesting one: a real
 * foreign price we hold no rate for, which the UI has to say out loud rather
 * than quietly showing the raw number as if it were dollars.
 */
function conversionFor(draft: ProductDraft) {
  const code = normaliseCode(draft.currency);
  const isForeign = Boolean(code && code !== 'USD');

  const price = toUsd(draft.price, draft.currency);
  const compareAt = toUsd(draft.compareAtPrice, draft.currency);
  const applied = price ?? compareAt;

  if (!applied) {
    return isForeign && draft.price !== null
      ? { currency: code, unconvertible: true as const }
      : null;
  }

  return {
    currency: applied.sourceCurrency,
    rate: applied.rate,
    priceUsd: price?.usd ?? null,
    compareAtUsd: compareAt?.usd ?? null,
    /** "¥120.00", for showing beside the converted figure. */
    sourceLabel: price ? formatSource(price.sourceAmount, price.sourceCurrency) : null,
    unconvertible: false as const,
  };
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

  const { denied } = authorizeImport(request, cookies, body.token);
  if (denied) return denied;

  // The extension's route: the page is already parsed, so nothing is fetched.
  if (body.browser && typeof body.browser === 'object') {
    const draft = draftFromBrowser(body.browser as Record<string, unknown>);
    const found = Boolean(draft.name);
    return jsonFor(request, {
      draft,
      found,
      conversion: conversionFor(draft),
      note: found
        ? draft.price === null
          ? 'No price was on that page — type one in.'
          : null
        : 'Could not find a product name on that page.',
    });
  }

  let url = String(body.url ?? '').trim();
  if (!url) return jsonFor(request, { error: 'Paste a product link first.' }, 400);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
  } catch {
    return jsonFor(request, { error: 'That is not a web address.' }, 400);
  }

  const outcome = await scrapeProduct(url);
  return jsonFor(request, { ...outcome, conversion: conversionFor(outcome.draft) });
};
