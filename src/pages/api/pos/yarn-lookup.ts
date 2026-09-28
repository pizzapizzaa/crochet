export const prerender = false;

import type { APIRoute } from 'astro';
import { authorizeImport, jsonFor, preflight } from '../../../lib/apiAuth';
import { scrapeYarn, yarnFromText } from '../../../lib/scrape/yarn';

/*
 * "Here is a yarn — what are its specs?" for the pattern generator.
 *
 * Read-only, like product-scrape: it fetches and parses, and writes nothing.
 * Three callers, three ways in:
 *
 *   { url }                 the generator's link box — the server fetches it
 *   { text, url? }          the paste box, for shops that will not serve us
 *   { browser: { url, title, text } }
 *                           the extension, with a page Chrome already rendered
 *
 * The last two exist for Taobao, which only shows a listing to a signed-in
 * browser, so no server fetch will ever get further than its login page.
 */

/** A spec table is a few kilobytes; this is room for a whole rendered page. */
const MAX_TEXT = 60_000;

export const OPTIONS: APIRoute = ({ request }) => preflight(request);

const textOf = (value: unknown) => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : '');
const shortOf = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) || null : null);

export const POST: APIRoute = async ({ request, cookies }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonFor(request, { error: 'Invalid request body.' }, 400);
  }

  const { denied } = authorizeImport(request, cookies, body.token);
  if (denied) return denied;

  if (body.browser && typeof body.browser === 'object') {
    const page = body.browser as Record<string, unknown>;
    const text = textOf(page.text);
    if (!text.trim()) return jsonFor(request, { error: 'Nothing was read off that page.' }, 400);
    return jsonFor(request, yarnFromText(text, { url: shortOf(page.url, 1000), title: shortOf(page.title, 300) }));
  }

  if (typeof body.text === 'string') {
    const text = textOf(body.text);
    if (!text.trim()) return jsonFor(request, { error: 'Paste the yarn’s spec text first.' }, 400);
    return jsonFor(request, yarnFromText(text, { url: shortOf(body.url, 1000) }));
  }

  let url = String(body.url ?? '').trim();
  if (!url) return jsonFor(request, { error: 'Paste a yarn link first.' }, 400);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
  } catch {
    return jsonFor(request, { error: 'That is not a web address.' }, 400);
  }

  return jsonFor(request, await scrapeYarn(url));
};
