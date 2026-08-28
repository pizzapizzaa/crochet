/*
 * Turning a pasted Pinterest link into a pin we can credit.
 *
 * Pinterest has no public API we are entitled to use here, so this reads what
 * the pin already publishes to any visitor: the oEmbed endpoint first (cheap,
 * structured, and it names the pinner), falling back to the Open Graph tags on
 * the pin page. Both are best-effort — the POS always lets the shop owner type
 * the author in by hand, because attribution is required and a failed scrape is
 * not allowed to be the reason it goes missing.
 */

export interface PinLookup {
  /** Canonical https://www.pinterest.com/pin/<id>/ form. */
  url: string;
  pinId: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  authorName: string | null;
  authorUrl: string | null;
  /** Which route produced the data — shown in the POS so a thin result is explicable. */
  via: 'oembed' | 'opengraph' | 'none';
}

const PIN_HOSTS = [
  'pinterest.com',
  'pin.it',
  'pinterest.co.uk',
  'pinterest.ca',
  'pinterest.com.au',
  'pinterest.com.mx',
  'pinterest.de',
  'pinterest.fr',
  'pinterest.es',
  'pinterest.it',
  'pinterest.jp',
  'pinterest.ph',
  'pinterest.se',
  'pinterest.at',
  'pinterest.ch',
  'pinterest.cl',
  'pinterest.dk',
  'pinterest.ie',
  'pinterest.nz',
  'pinterest.pt',
  'pinterest.ru',
];

/** Any Pinterest domain, including the locale subdomains such as br.pinterest.com. */
export function isPinterestUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    return PIN_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

/** The numeric id out of /pin/<id>/, or null for a board or profile link. */
export function pinIdFrom(raw: string): string | null {
  try {
    const match = new URL(raw).pathname.match(/\/pin\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Strip the tracking query Pinterest appends to shared links and settle on one
 * spelling, so the same pin saved twice is recognisably the same pin.
 */
export function canonicalPinUrl(raw: string): string {
  const trimmed = raw.trim();
  const id = pinIdFrom(trimmed);
  if (id) return `https://www.pinterest.com/pin/${id}/`;
  try {
    const url = new URL(trimmed);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return trimmed;
  }
}

/** A browser-ish UA — Pinterest serves a stub page to an obvious bot. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** pin.it short links 302 to the real pin — follow one to get an id we can store. */
async function resolveShortLink(raw: string): Promise<string> {
  try {
    if (!/(^|\.)pin\.it$/i.test(new URL(raw).hostname)) return raw;
  } catch {
    return raw;
  }
  try {
    const res = await fetchWithTimeout(raw, { redirect: 'follow' });
    return res.url || raw;
  } catch {
    return raw;
  }
}

function decodeEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/** First matching meta tag, in either attribute order. */
function metaTag(html: string, key: string): string | null {
  const patterns = [
    new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*content=["\']([^"\']*)["\']', 'i'),
    new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + key + '["\']', 'i'),
  ];
  for (const re of patterns) {
    const hit = html.match(re);
    if (hit?.[1]) return decodeEntities(hit[1]);
  }
  return null;
}

/**
 * Pinterest puts a downscaled preview in og:image. The full-resolution file
 * sits at the same path under /originals/, so ask for that instead — the
 * caller mirrors it, and a miss there just falls back to the preview.
 */
export function upgradePinImage(url: string): string {
  return url.replace(/\/\d+x\d*\//, '/originals/');
}

async function viaOembed(url: string): Promise<Partial<PinLookup> | null> {
  try {
    const res = await fetchWithTimeout(
      'https://www.pinterest.com/oembed.json?url=' + encodeURIComponent(url),
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const thumb = typeof json.thumbnail_url === 'string' ? json.thumbnail_url : null;
    const author = typeof json.author_name === 'string' ? json.author_name : null;
    if (!thumb && !author) return null;
    return {
      title: typeof json.title === 'string' ? json.title : null,
      imageUrl: thumb,
      authorName: author,
      authorUrl: typeof json.author_url === 'string' ? json.author_url : null,
      via: 'oembed',
    };
  } catch {
    return null;
  }
}

async function viaOpenGraph(url: string): Promise<Partial<PinLookup> | null> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();

    const image = metaTag(html, 'og:image') ?? metaTag(html, 'twitter:image');
    const title = metaTag(html, 'og:title') ?? metaTag(html, 'twitter:title');
    const description = metaTag(html, 'og:description');

    // article:author carries the pinner on most locales; the embedded JSON in
    // the page body is the fallback when it does not.
    const authorName =
      metaTag(html, 'article:author') ??
      html.match(/"pinner"\s*:\s*\{[^}]*"full_name"\s*:\s*"([^"]+)"/)?.[1] ??
      null;
    const handle =
      html.match(/"pinner"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"/)?.[1] ??
      metaTag(html, 'profile:username') ??
      null;

    if (!image && !title && !authorName) return null;
    return {
      title,
      description,
      imageUrl: image,
      authorName: authorName ? decodeEntities(authorName) : null,
      authorUrl: handle ? 'https://www.pinterest.com/' + handle + '/' : null,
      via: 'opengraph',
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort read of a pin. Never throws: an empty result is a normal outcome
 * that the POS handles by asking for the details by hand.
 */
export async function lookupPin(rawUrl: string): Promise<PinLookup> {
  const resolved = await resolveShortLink(rawUrl.trim());
  const url = canonicalPinUrl(resolved);

  const empty: PinLookup = {
    url,
    pinId: pinIdFrom(url),
    title: null,
    description: null,
    imageUrl: null,
    authorName: null,
    authorUrl: null,
    via: 'none',
  };

  // oEmbed is the polite route; Open Graph fills whatever it leaves blank.
  const [oembed, og] = await Promise.all([viaOembed(url), viaOpenGraph(url)]);
  if (!oembed && !og) return empty;

  const merged: PinLookup = {
    ...empty,
    title: oembed?.title ?? og?.title ?? null,
    description: og?.description ?? null,
    imageUrl: oembed?.imageUrl ?? og?.imageUrl ?? null,
    authorName: oembed?.authorName ?? og?.authorName ?? null,
    authorUrl: oembed?.authorUrl ?? og?.authorUrl ?? null,
    via: oembed ? 'oembed' : 'opengraph',
  };

  if (merged.imageUrl) merged.imageUrl = upgradePinImage(merged.imageUrl);
  return merged;
}

/* ── Bulk ────────────────────────────────────────────────────────────
 *
 * Everything below serves /pos/makes/import, where the shop owner pastes a
 * whole afternoon of pinning at once rather than one link at a time.
 */

/** Cap on how many pins one paste can carry, so a stray paste cannot melt the box. */
export const MAX_BULK_URLS = 100;

/**
 * Pull Pinterest links out of whatever got pasted. People paste a tidy list,
 * a wall of text from a chat, or a copied board with the links buried in it,
 * so this reads URLs out of prose rather than insisting on one per line.
 *
 * Bare pin ids are accepted too — "1234567890" on its own line is a pin.
 * Duplicates collapse, and order is kept so the preview matches the paste.
 */
export function extractPinterestUrls(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (candidate: string) => {
    // Trailing punctuation is a paste artefact, not part of the link.
    const cleaned = candidate.replace(/[)\]},.;'"]+$/, '');
    const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : 'https://' + cleaned;
    if (!isPinterestUrl(withScheme)) return;
    const canonical = canonicalPinUrl(withScheme);
    if (seen.has(canonical)) return;
    seen.add(canonical);
    found.push(canonical);
  };

  for (const match of text.matchAll(/(?:https?:\/\/)?[\w.-]*\bpin(?:terest)?[\w.-]*\.[a-z.]{2,12}\/\S*/gi)) {
    push(match[0]);
  }

  // A column of bare ids, which is what copying from a spreadsheet gives you.
  for (const line of text.split(/\r?\n/)) {
    const bare = line.trim();
    if (/^\d{6,25}$/.test(bare)) push(`https://www.pinterest.com/pin/${bare}/`);
  }

  return found.slice(0, MAX_BULK_URLS);
}

/** A /pin/<id>/ link, as opposed to a board, a profile or a search. */
export function isPinUrl(raw: string): boolean {
  return isPinterestUrl(raw) && pinIdFrom(raw) !== null;
}

/**
 * Every pin id mentioned in a page of Pinterest HTML, in first-seen order.
 * Board pages ship a chunk of embedded JSON that names the pins above the
 * fold, which is what this reads.
 */
export function pinIdsFromHtml(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const patterns = [/\/pin\/(\d{6,25})\//g, /"(?:id|pin_id)"\s*:\s*"(\d{12,25})"/g];

  for (const re of patterns) {
    for (const match of html.matchAll(re)) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export interface BoardScan {
  /** Canonical pin URLs found on the board page. */
  pinUrls: string[];
  /** Why the list is short or empty, when it is. */
  note: string | null;
}

/**
 * Best-effort read of a board or profile page.
 *
 * Pinterest renders boards in the browser, so the HTML a server gets holds
 * only the pins that made it into the page's bootstrap JSON — usually the
 * first screenful, sometimes none at all. That is a real ceiling, not a bug to
 * work around, so the result says so and the POS points at the browser
 * extension, which reads the board the visitor can actually see.
 */
export async function scanBoard(rawUrl: string): Promise<BoardScan> {
  const url = await resolveShortLink(rawUrl.trim());

  if (isPinUrl(url)) {
    return { pinUrls: [canonicalPinUrl(url)], note: null };
  }

  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!res.ok) {
      return { pinUrls: [], note: `Pinterest answered ${res.status} for that board.` };
    }

    const ids = pinIdsFromHtml(await res.text()).slice(0, MAX_BULK_URLS);
    if (ids.length === 0) {
      return {
        pinUrls: [],
        note: 'No pins were in the board HTML — Pinterest builds boards in the browser. Open the board, scroll, and use the extension to collect the pins, or paste the pin links yourself.',
      };
    }

    return {
      pinUrls: ids.map((id) => `https://www.pinterest.com/pin/${id}/`),
      note: `Found ${ids.length} pin${ids.length === 1 ? '' : 's'} in the board's first screenful. Scroll the board in the extension to collect the rest.`,
    };
  } catch {
    return { pinUrls: [], note: 'Could not reach that board.' };
  }
}
