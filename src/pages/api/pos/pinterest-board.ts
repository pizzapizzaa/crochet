export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { isPinterestUrl, scanBoard } from '../../../lib/pinterest';

/*
 * "Here is a board, give me its pins."
 *
 * A partial answer, and honest about it: Pinterest assembles boards in the
 * browser, so a server only ever sees the pins baked into the page's bootstrap
 * JSON. The import screen prints the note this returns, which is where the
 * browser extension gets recommended for the rest.
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

  if (!url) return json({ error: 'Paste a board link first.' }, 400);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!isPinterestUrl(url)) return json({ error: 'That is not a Pinterest link.' }, 400);

  const scan = await scanBoard(url);
  return json(scan);
};
