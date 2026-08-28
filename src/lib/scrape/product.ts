import {
  absoluteUrl,
  documentTitle,
  fetchPage,
  isFetchableUrl,
  guessCurrency,
  metaContent,
  metaContentAll,
  parsePrice,
  siteNameFrom,
  stripTags,
} from './html';

/*
 * Reading a product off somebody else's shop page.
 *
 * Every route here reads structured data the page already publishes for
 * Google, Facebook and its own storefront JavaScript: JSON-LD, Open Graph,
 * schema.org microdata, and — on Shopify, which is most small yarn shops —
 * the .json endpoint the shop serves next to every product. Nothing guesses
 * from layout, because layout is where scrapers go to rot.
 *
 * What comes back is a *draft*, never a product. It is handed to the POS form
 * for a human to price, describe and file, because the two things a scrape is
 * worst at are exactly the two things that matter most: what we should charge
 * for it, and which category of ours it belongs in.
 *
 * A note on what this is for. The importer copies a supplier's listing into
 * our own catalogue so we can stock and resell the item; the source URL is
 * kept on the row as `supplier_url` so provenance is never lost. It is not a
 * tool for cloning a competitor's shop, and the description it lifts is a
 * starting point to rewrite, not something to publish verbatim.
 */

export type ScrapeSource = 'shopify' | 'json-ld' | 'microdata' | 'open-graph' | 'page' | 'browser';

export interface ProductDraft {
  sourceUrl: string;
  siteName: string;
  name: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  compareAtPrice: number | null;
  images: string[];
  sku: string | null;
  brand: string | null;
  /** 'in stock', 'out of stock', or whatever the page said. */
  availability: string | null;
  tags: string[];
  /** Which routes contributed, so a thin result is explicable in the POS. */
  via: ScrapeSource[];
}

export interface ScrapeOutcome {
  draft: ProductDraft;
  /** True when we got enough to be worth showing: a name and something else. */
  found: boolean;
  /** Said to the shop owner verbatim — what to do, not what broke. */
  note: string | null;
}

const MAX_IMAGES = 10;

/** The shop's own name for itself when the page is unreadable: its hostname. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the source page';
  }
}

function emptyDraft(url: string, siteName: string): ProductDraft {
  return {
    sourceUrl: url,
    siteName,
    name: null,
    description: null,
    price: null,
    currency: null,
    compareAtPrice: null,
    images: [],
    sku: null,
    brand: null,
    availability: null,
    tags: [],
    via: [],
  };
}

/**
 * First non-empty value wins, so callers pass their sources best-first. Lists
 * (images, tags) accumulate instead, since a second route usually knows about
 * photographs the first one did not.
 *
 * `via` is only credited to a route that actually contributed something —
 * otherwise every page would claim four sources and the badge would stop
 * meaning anything.
 */
function merge(base: ProductDraft, parts: Partial<ProductDraft>[]): ProductDraft {
  const out = { ...base };

  for (const part of parts) {
    const { via, ...fields } = part;
    let contributed = false;

    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined) continue;

      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        const existing = (out as Record<string, unknown>)[key] as unknown[] | undefined;
        const merged = [...new Set([...(existing ?? []), ...value])];
        if (merged.length > (existing?.length ?? 0)) contributed = true;
        (out as Record<string, unknown>)[key] = merged;
        continue;
      }

      if (typeof value === 'string' && !value.trim()) continue;
      const current = (out as Record<string, unknown>)[key];
      if (current === null || current === undefined || current === '') {
        (out as Record<string, unknown>)[key] = value;
        contributed = true;
      }
    }

    if (contributed && via?.length) out.via = [...new Set([...out.via, ...via])];
  }

  out.images = out.images.slice(0, MAX_IMAGES);
  out.tags = out.tags.slice(0, 15);
  return out;
}

/* ── JSON-LD ──────────────────────────────────────────────────────── */

type Node = Record<string, unknown>;

/** Every object in a JSON-LD payload, @graph and nested arrays flattened out. */
function flatten(value: unknown, into: Node[] = [], depth = 0): Node[] {
  if (depth > 6 || value === null || typeof value !== 'object') return into;
  if (Array.isArray(value)) {
    for (const entry of value) flatten(entry, into, depth + 1);
    return into;
  }
  const node = value as Node;
  into.push(node);
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'hasVariant', 'offers']) {
    if (node[key]) flatten(node[key], into, depth + 1);
  }
  return into;
}

function jsonLdNodes(html: string): Node[] {
  const nodes: Node[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    // Some shops emit JSON-LD with an HTML comment wrapper or a trailing comma.
    const raw = match[1].replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
    if (!raw) continue;
    try {
      flatten(JSON.parse(raw), nodes);
    } catch {
      // A malformed block is one route of several; the others still run.
    }
  }
  return nodes;
}

const typeOf = (node: Node): string[] => {
  const raw = node['@type'] ?? node.type;
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase());
};

const str = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const node = value as Node;
    const named = node.name ?? node['@value'] ?? node.value;
    return typeof named === 'string' ? named.trim() || null : null;
  }
  return null;
};

/** image can be a string, a list, or an ImageObject — sometimes all three. */
function imagesFrom(value: unknown, base: string): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of list) {
    const raw =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? ((entry as Node).url ?? (entry as Node).contentUrl)
          : null;
    if (typeof raw !== 'string') continue;
    const absolute = absoluteUrl(raw, base);
    if (absolute && !out.includes(absolute)) out.push(absolute);
  }
  return out;
}

function fromJsonLd(html: string, base: string): Partial<ProductDraft> | null {
  const nodes = jsonLdNodes(html);
  const product = nodes.find((n) => typeOf(n).some((t) => t === 'product' || t === 'productgroup'));
  if (!product) return null;

  // Offers is the messiest corner of the spec: one object, a list of them, or
  // an AggregateOffer with a range. Take the lowest concrete price offered.
  const offers = flatten(product.offers, []).filter((n) =>
    typeOf(n).some((t) => t.includes('offer')),
  );
  const prices = offers
    .map((o) => parsePrice(o.price ?? o.lowPrice ?? (o.priceSpecification as Node)?.price))
    .filter((p): p is number => p !== null);

  const currency = offers
    .map((o) => str(o.priceCurrency) ?? str((o.priceSpecification as Node)?.priceCurrency))
    .find(Boolean);

  const availability = offers.map((o) => str(o.availability)).find(Boolean);

  const description = str(product.description);

  return {
    name: str(product.name),
    description: description ? stripTags(description) : null,
    price: prices.length ? Math.min(...prices) : null,
    currency: currency ? currency.replace(/^.*\//, '').toUpperCase().slice(0, 3) : null,
    images: imagesFrom(product.image, base),
    sku: str(product.sku) ?? str(product.mpn) ?? str(product.gtin13),
    brand: str(product.brand) ?? str(product.manufacturer),
    availability: availability ? availability.replace(/^.*\//, '') : null,
    tags: [str(product.category)].filter((t): t is string => Boolean(t)),
    via: ['json-ld'],
  };
}

/* ── Shopify ──────────────────────────────────────────────────────── */

/** Shopify leaves its fingerprints in every theme it renders. */
export function looksLikeShopify(html: string): boolean {
  return /cdn\.shopify\.com|Shopify\.theme|shopify-section|window\.Shopify/i.test(html);
}

/**
 * Shopify serves clean JSON next to every product page, which beats reading
 * the rendered HTML on every count — real variant prices, the full body copy
 * and every photograph rather than the one in og:image.
 */
async function fromShopify(url: string): Promise<Partial<ProductDraft> | null> {
  let jsonUrl: string;
  try {
    const parsed = new URL(url);
    if (!/\/products\/[^/]+/.test(parsed.pathname)) return null;
    // Trim anything after the handle: collection-scoped URLs 404 as .json.
    const handlePath = parsed.pathname.match(/^.*?\/products\/[^/]+/)?.[0] ?? parsed.pathname;
    parsed.pathname = handlePath.replace(/\.json$/, '') + '.json';
    parsed.search = '';
    jsonUrl = parsed.toString();
    if (!isFetchableUrl(jsonUrl)) return null;
  } catch {
    return null;
  }

  try {
    const res = await fetch(jsonUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { product?: Node };
    const product = body.product;
    if (!product || typeof product !== 'object') return null;

    const variants = Array.isArray(product.variants) ? (product.variants as Node[]) : [];
    const prices = variants.map((v) => parsePrice(v.price)).filter((p): p is number => p !== null);
    const compares = variants
      .map((v) => parsePrice(v.compare_at_price))
      .filter((p): p is number => p !== null);

    const images = Array.isArray(product.images)
      ? (product.images as Node[])
          .map((i) => (typeof i === 'string' ? i : str(i.src)))
          .filter((s): s is string => Boolean(s))
      : [];

    const bodyHtml = str(product.body_html);

    return {
      name: str(product.title),
      description: bodyHtml ? stripTags(bodyHtml) : null,
      price: prices.length ? Math.min(...prices) : null,
      compareAtPrice: compares.length ? Math.max(...compares) : null,
      images: images.map((i) => absoluteUrl(i, url)).filter((i): i is string => Boolean(i)),
      sku: variants.map((v) => str(v.sku)).find(Boolean) ?? null,
      brand: str(product.vendor),
      availability: variants.some((v) => v.available === true) ? 'InStock' : null,
      tags: [
        ...(Array.isArray(product.tags) ? (product.tags as unknown[]).map(str) : []),
        str(product.product_type),
      ].filter((t): t is string => Boolean(t)),
      via: ['shopify'],
    };
  } catch {
    return null;
  }
}

/* ── Open Graph and the rest of the page ──────────────────────────── */

function fromOpenGraph(html: string, base: string): Partial<ProductDraft> {
  const priceRaw =
    metaContent(html, 'product:price:amount') ??
    metaContent(html, 'og:price:amount') ??
    metaContent(html, 'twitter:data1');

  const images = [
    ...metaContentAll(html, 'og:image:secure_url'),
    ...metaContentAll(html, 'og:image'),
    ...metaContentAll(html, 'twitter:image'),
  ]
    .map((i) => absoluteUrl(i, base))
    .filter((i): i is string => Boolean(i));

  return {
    name: metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title'),
    description: metaContent(html, 'og:description') ?? metaContent(html, 'description'),
    price: parsePrice(priceRaw),
    currency:
      metaContent(html, 'product:price:currency') ??
      metaContent(html, 'og:price:currency') ??
      guessCurrency(priceRaw),
    compareAtPrice: parsePrice(metaContent(html, 'product:original_price:amount')),
    images,
    sku: metaContent(html, 'product:retailer_item_id') ?? metaContent(html, 'product:sku'),
    brand: metaContent(html, 'product:brand') ?? metaContent(html, 'og:brand'),
    availability: metaContent(html, 'product:availability') ?? metaContent(html, 'og:availability'),
    via: ['open-graph'],
  };
}

/** Shallow schema.org microdata — enough for the shops that still use it. */
function fromMicrodata(html: string, base: string): Partial<ProductDraft> {
  const prop = (name: string): string | null => {
    const patterns = [
      new RegExp(`itemprop=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`content=["']([^"']+)["'][^>]*itemprop=["']${name}["']`, 'i'),
      new RegExp(`itemprop=["']${name}["'][^>]*>([^<]{1,200})<`, 'i'),
    ];
    for (const re of patterns) {
      const hit = html.match(re);
      if (hit?.[1]?.trim()) return stripTags(hit[1]);
    }
    return null;
  };

  const image = prop('image');
  return {
    name: prop('name'),
    price: parsePrice(prop('price')),
    currency: prop('priceCurrency'),
    sku: prop('sku'),
    brand: prop('brand'),
    availability: prop('availability'),
    images: image ? [absoluteUrl(image, base)].filter((i): i is string => Boolean(i)) : [],
    via: ['microdata'],
  };
}

/** Last resort. A page title is a poor product name but it beats nothing. */
function fromPage(html: string): Partial<ProductDraft> {
  const title = documentTitle(html);
  if (!title) return {};
  // Titles are usually "Product name – Shop name"; keep the longer half.
  const parts = title.split(/\s+[|–—·]\s+/).filter(Boolean);
  const name = parts.length > 1 ? parts.sort((a, b) => b.length - a.length)[0] : title;
  return { name: name.slice(0, 140), via: ['page'] };
}

/* ── The whole run ────────────────────────────────────────────────── */

/** Drop the tracking query a shared shop link carries, keep everything else. */
export function tidySourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|_ga|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return raw.trim();
  }
}

/**
 * Read one product page. Never throws: a page that refuses to be read comes
 * back as an empty draft with a note explaining what to do instead, which for
 * the shops that block servers outright means "open it in Chrome and use the
 * extension".
 */
export async function scrapeProduct(rawUrl: string): Promise<ScrapeOutcome> {
  const url = tidySourceUrl(rawUrl);

  if (!isFetchableUrl(url)) {
    return {
      draft: emptyDraft(url, hostLabel(url)),
      found: false,
      note: 'That is not a public web address, so there is nothing for the shop to read.',
    };
  }

  let page: { html: string; finalUrl: string; status: number };
  try {
    page = await fetchPage(url);
  } catch {
    return {
      draft: emptyDraft(url, hostLabel(url)),
      found: false,
      note: 'That page did not answer in time. Open it in Chrome and use the ZippyZack extension, which reads the page you can see.',
    };
  }

  let siteName = hostLabel(page.finalUrl);
  try {
    if (page.html) siteName = siteNameFrom(page.html, page.finalUrl);
  } catch {
    // The hostname is a fine name for a shop that will not give its own.
  }

  if (!page.html) {
    return {
      draft: emptyDraft(url, siteName),
      found: false,
      note:
        page.status === 403 || page.status === 401 || page.status === 429
          ? `${siteName} refused the request (${page.status}) — plenty of big shops block anything that is not a browser. Open the page in Chrome and use the ZippyZack extension instead.`
          : page.status === 0
            ? 'That link redirected somewhere the shop will not follow. Check where it points.'
            : `${siteName} answered ${page.status} for that link. Check the URL, or use the extension.`,
    };
  }

  const base = page.finalUrl;
  const parts: Partial<ProductDraft>[] = [];

  /*
   * Every route below reads markup written by a stranger. Any one of them
   * throwing on input nobody anticipated must not take the endpoint down with
   * it — an unreadable page is a normal outcome here, and it has an answer
   * already: the empty draft and a note saying what to do instead.
   */
  try {
    // Best source first: merge() keeps the first value it is given for a field.
    if (looksLikeShopify(page.html)) {
      const shopify = await fromShopify(base);
      if (shopify) parts.push(shopify);
    }
    const jsonLd = fromJsonLd(page.html, base);
    if (jsonLd) parts.push(jsonLd);
    parts.push(fromMicrodata(page.html, base), fromOpenGraph(page.html, base), fromPage(page.html));
  } catch {
    // Whatever was collected before the throw is still worth showing.
  }

  const draft = merge(emptyDraft(page.finalUrl, siteName), parts);
  const found = Boolean(draft.name && (draft.price !== null || draft.images.length > 0));

  return {
    draft,
    found,
    note: found
      ? draft.price === null
        ? 'No price was published on that page — type one in below.'
        : null
      : draft.name
        ? 'Only the name came back. Fill in the price and a photo, or use the extension, which reads the rendered page.'
        : `Nothing product-shaped was published on that page. If it is behind a "load more" or a login, the ZippyZack extension can read it from your browser instead.`,
  };
}

/* ── The browser's version ────────────────────────────────────────── */

export interface BrowserPayload {
  url?: unknown;
  siteName?: unknown;
  name?: unknown;
  description?: unknown;
  price?: unknown;
  currency?: unknown;
  compareAtPrice?: unknown;
  images?: unknown;
  sku?: unknown;
  brand?: unknown;
  availability?: unknown;
  tags?: unknown;
}

const text = (value: unknown, max: number): string | null => {
  const out = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return out ? out.slice(0, max) : null;
};

/**
 * The same shape, but read by the extension out of a page Chrome has already
 * rendered. Everything is re-checked here: it arrives over the network from
 * a script running on a stranger's website, so none of it is trusted as-is.
 */
export function draftFromBrowser(payload: BrowserPayload): ProductDraft {
  const sourceUrl = tidySourceUrl(text(payload.url, 1000) ?? '');
  const siteName = text(payload.siteName, 80) ?? hostLabel(sourceUrl);

  const images = (Array.isArray(payload.images) ? payload.images : [])
    .map((i) => (typeof i === 'string' ? absoluteUrl(i, sourceUrl || 'https://example.invalid') : null))
    .filter((i): i is string => Boolean(i))
    .slice(0, MAX_IMAGES);

  const currency = text(payload.currency, 8);

  return {
    sourceUrl,
    siteName,
    name: text(payload.name, 140),
    description: text(payload.description, 4000),
    price: parsePrice(payload.price),
    currency: currency ? currency.toUpperCase().slice(0, 3) : guessCurrency(text(payload.price, 40)),
    compareAtPrice: parsePrice(payload.compareAtPrice),
    images: [...new Set(images)],
    sku: text(payload.sku, 60),
    brand: text(payload.brand, 80),
    availability: text(payload.availability, 40),
    tags: (Array.isArray(payload.tags) ? payload.tags : [])
      .map((t) => text(t, 40))
      .filter((t): t is string => Boolean(t))
      .slice(0, 15),
    via: ['browser'],
  };
}
