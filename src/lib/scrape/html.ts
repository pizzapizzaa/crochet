/*
 * The small amount of HTML handling both scrapers need.
 *
 * There is no DOM on the server and no parser in the dependency list, so this
 * works on the markup as text. That is a real constraint and it shapes what
 * the product scraper attempts: structured data first (JSON-LD, meta tags,
 * a shop's own JSON endpoint), and only the shallowest guesses from the body.
 * Anything that would need a real tree — "the price is the third span inside
 * the div after the h1" — is the browser extension's job, because there the
 * page has already been parsed by Chrome.
 */

/** Enough of a browser to be served the real page, honest about being a fetch. */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const TIMEOUT_MS = 12000;

/** A product page is tens of kilobytes; a megabyte of it is more than enough. */
const MAX_HTML_BYTES = 2 * 1024 * 1024;

/*
 * Only fetch things that live on the public internet.
 *
 * These endpoints take a URL from whoever is signed in and fetch it from the
 * server, which is the shape of a request-forgery hole: "scrape this" pointed
 * at a private address turns the shop into a probe of its own network. The
 * only URLs worth importing from are public shops, so anything that resolves
 * to a name reserved for a private network is refused outright.
 */
const PRIVATE_HOST = [
  // A dotted quad from a private range, wherever it sits in the name: the
  // wildcard-DNS services resolve foo.127.0.0.1.example to that address.
  /(^|\.)(127|10|0)\.\d{1,3}\.\d{1,3}\.\d{1,3}(\.|$)/,
  /(^|\.)169\.254\.\d{1,3}\.\d{1,3}(\.|$)/,
  /(^|\.)192\.168\.\d{1,3}\.\d{1,3}(\.|$)/,
  /(^|\.)172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(\.|$)/,
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
];

/** http(s) only, and not pointed at something on our own side of the wire. */
export function isFetchableUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (!host || (!host.includes('.') && !host.includes(':'))) return false;
    return !PRIVATE_HOST.some((re) => re.test(host));
  } catch {
    return false;
  }
}

export interface FetchedPage {
  html: string;
  /** Where we ended up, which is what redirects and short links make necessary. */
  finalUrl: string;
  status: number;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) return { html: '', finalUrl: res.url || url, status: res.status };

    // A redirect is a second address, and it gets the same refusal as the
    // first: "scrape this" must not become a way to read a private network.
    if (res.url && !isFetchableUrl(res.url)) {
      return { html: '', finalUrl: res.url, status: 0 };
    }

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer.byteLength > MAX_HTML_BYTES ? buffer.slice(0, MAX_HTML_BYTES) : buffer);
    return {
      html: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      finalUrl: res.url || url,
      status: res.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  amp: '&',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  eacute: 'é',
  times: '×',
  euro: '€',
  pound: '£',
  yen: '¥',
};

/**
 * A numeric entity naming something outside Unicode — `&#x110000;` — makes
 * String.fromCodePoint throw, and this runs on markup from strangers. An
 * impossible code point is left as the text it was written as.
 */
const codePoint = (value: number, original: string): string =>
  Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : original;

/** &amp; last, so a doubly-encoded entity does not decode into markup. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => codePoint(parseInt(hex, 16), whole))
    .replace(/&#(\d+);/g, (whole, dec) => codePoint(Number(dec), whole))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .trim();
}

/** Markup to readable prose: drop script/style wholesale, keep paragraph breaks. */
export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|br|tr|h[1-6])\s*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

/** The content of a meta tag, written either attribute-order round. */
export function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${escaped}["']`, 'i'),
  ];
  for (const re of patterns) {
    const hit = html.match(re);
    if (hit?.[1]) {
      const value = decodeEntities(hit[1]);
      if (value) return value;
    }
  }
  return null;
}

/** Every content value published under one meta key — og:image repeats. */
export function metaContentAll(html: string, key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
    'gi',
  );
  const out: string[] = [];
  for (const match of html.matchAll(re)) {
    const value = decodeEntities(match[1]);
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/** The <title>, which is the last thing left when a page publishes nothing. */
export function documentTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(stripTags(match[1])) || null : null;
}

/** Turn a page-relative src into something we can fetch. */
export function absoluteUrl(candidate: string, base: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return trimmed;
  try {
    const url = new URL(trimmed.startsWith('//') ? 'https:' + trimmed : trimmed, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * "£12.50", "USD 12.50", "1.234,56 €" → 12.5 / 1234.56.
 *
 * The comma is the hard part: it is a thousands separator in one half of the
 * world and a decimal point in the other. Whichever of . and , appears last
 * and has two or three digits behind it is treated as the decimal mark.
 */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== 'string') return null;

  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/(?!^)-/g, '');
  if (!/\d/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalised = cleaned;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    normalised =
      cleaned.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + cleaned.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    const tail = cleaned.length - lastComma - 1;
    // "1,50" is a price; "1,500" is a thousand and a half.
    normalised = tail === 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const tail = cleaned.length - lastDot - 1;
    normalised = tail === 3 && cleaned.split('.').length > 2 ? cleaned.replace(/\./g, '') : cleaned;
  }

  const value = Number(normalised);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '¥': 'JPY',
  '₫': 'VND',
  '₹': 'INR',
  '₩': 'KRW',
  'A$': 'AUD',
  'C$': 'CAD',
};

/** An ISO code out of a price string, from the code itself or its symbol. */
export function guessCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const iso = raw.match(/\b([A-Z]{3})\b/);
  if (iso && iso[1] !== 'NEW') return iso[1];
  for (const [symbol, code] of Object.entries(CURRENCY_BY_SYMBOL)) {
    if (raw.includes(symbol)) return code;
  }
  return null;
}

/** A readable shop name for the provenance note. */
export function siteNameFrom(html: string, url: string): string {
  const declared = metaContent(html, 'og:site_name');
  if (declared) return declared.slice(0, 80);
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the source page';
  }
}
