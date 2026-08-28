export const prerender = false;

import type { APIRoute } from 'astro';
import { authorizeImport, jsonFor, preflight } from '../../../lib/apiAuth';
import { draftFromBrowser, scrapeProduct } from '../../../lib/scrape/product';

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
  return jsonFor(request, outcome);
};
