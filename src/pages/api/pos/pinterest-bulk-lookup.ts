export const prerender = false;

import type { APIRoute } from 'astro';
import { guardApi } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { canonicalPinUrl, isPinterestUrl, lookupPin, pinIdFrom } from '../../../lib/pinterest';

/*
 * Reads a handful of pins at once for /pos/makes/import.
 *
 * The import screen holds a queue of pasted links and sends them here a few at
 * a time rather than all in one request. Two reasons: a serverless function
 * has a wall-clock budget and forty pin fetches will not fit inside it, and a
 * screen that fills in row by row is a screen you can watch. Nothing is
 * written here — this is the preview half, and every row can still be edited
 * or dropped before /api/pos/pinterest-bulk-import saves anything.
 */

/** Fetched concurrently, so this is also the fan-out at Pinterest. */
const CHUNK_LIMIT = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export interface BulkLookupRow {
  url: string;
  pinId: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  authorName: string | null;
  authorUrl: string | null;
  via: string;
  /** The make already holding this pin, when there is one. */
  existing: { id: string; title: string } | null;
  /** Set when the row cannot become a make as it stands. */
  problem: string | null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (guardApi(cookies)) return json({ error: 'Not signed in.' }, 401);

  let urls: string[] = [];
  try {
    const body = await request.json();
    urls = Array.isArray(body?.urls) ? body.urls.map((u: unknown) => String(u ?? '').trim()) : [];
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  urls = urls.filter(Boolean).slice(0, CHUNK_LIMIT);
  if (urls.length === 0) return json({ rows: [] });

  const rows: BulkLookupRow[] = await Promise.all(
    urls.map(async (raw): Promise<BulkLookupRow> => {
      const withScheme = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      const url = canonicalPinUrl(withScheme);

      if (!isPinterestUrl(withScheme)) {
        return {
          url: raw,
          pinId: null,
          title: null,
          description: null,
          imageUrl: null,
          authorName: null,
          authorUrl: null,
          via: 'none',
          existing: null,
          problem: 'Not a Pinterest link.',
        };
      }

      const pin = await lookupPin(url);
      const found = Boolean(pin.imageUrl || pin.title || pin.authorName);

      return {
        url: pin.url,
        pinId: pin.pinId,
        title: pin.title,
        description: pin.description,
        imageUrl: pin.imageUrl,
        authorName: pin.authorName,
        authorUrl: pin.authorUrl,
        via: pin.via,
        existing: null,
        problem: found
          ? null
          : 'Pinterest returned nothing for this link — fill the title and author in by hand.',
      };
    }),
  );

  /*
   * Mark the pins we already hold. Importing the same pin twice is the easiest
   * mistake to make when you are pasting a board in batches, and it is far
   * cheaper to grey the row out here than to explain a duplicate later.
   */
  const admin = getSupabaseAdmin();
  if (admin) {
    // Only rows that are actually pins: a row rejected as "not a Pinterest
    // link" still carries whatever string the client sent, and there is
    // nothing to be gained by asking the database about it.
    const pins = rows.filter((r) => r.problem === null || r.pinId !== null);
    const ids = pins.map((r) => r.pinId ?? pinIdFrom(r.url)).filter((id): id is string => Boolean(id));
    const links = pins.map((r) => r.url);

    // Two plain .in() lookups rather than one hand-written or() filter: a pin
    // URL carries slashes and colons, and escaping those into a PostgREST
    // filter string by hand is the kind of thing that fails quietly and takes
    // duplicate detection down with it.
    const select = 'id, title, pinterest_url, pinterest_pin_id';
    const [byId, byUrl] = await Promise.all([
      ids.length
        ? admin.from('makes').select(select).in('pinterest_pin_id', ids)
        : Promise.resolve({ data: [] as { id: string; title: string; pinterest_url: string; pinterest_pin_id: string | null }[] }),
      links.length
        ? admin.from('makes').select(select).in('pinterest_url', links)
        : Promise.resolve({ data: [] as { id: string; title: string; pinterest_url: string; pinterest_pin_id: string | null }[] }),
    ]);

    const found = [...(byId.data ?? []), ...(byUrl.data ?? [])];
    for (const row of rows) {
      const match = found.find(
        (m) => (row.pinId && m.pinterest_pin_id === row.pinId) || m.pinterest_url === row.url,
      );
      if (match) row.existing = { id: match.id, title: match.title };
    }
  }

  return json({ rows });
};
