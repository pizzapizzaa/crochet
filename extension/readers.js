/*
 * The two things this extension reads out of a page.
 *
 * Both functions are injected into the page with chrome.scripting, which
 * serialises them to source and runs them there. That has one hard
 * consequence: they may not reference anything outside themselves — no
 * imports, no shared helpers, no constants from this file. Hence the repeated
 * little helpers inside each one. It is not an oversight.
 *
 * Reading the *rendered* page is the entire point of the extension. A server
 * fetching the same URL gets the pre-JavaScript version, and on plenty of
 * shops that has no price in it at all — and on some it has nothing, because
 * the shop refuses requests that are not a browser. Here the page has already
 * been built, by a browser, for a person who is looking at it.
 */

/** Everything a product page is willing to say about the thing it is selling. */
export function readProduct() {
  const absolute = (value) => {
    try {
      return new URL(value, location.href).href;
    } catch {
      return null;
    }
  };
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();

  /* ── Structured data ─────────────────────────────────────────── */
  const nodes = [];
  const flatten = (value, depth) => {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((entry) => flatten(entry, depth + 1));
      return;
    }
    nodes.push(value);
    ['@graph', 'mainEntity', 'itemListElement', 'hasVariant', 'offers'].forEach((key) => {
      if (value[key]) flatten(value[key], depth + 1);
    });
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      flatten(JSON.parse(script.textContent), 0);
    } catch {
      /* One malformed block does not spoil the rest. */
    }
  });

  const typesOf = (node) => {
    const raw = node['@type'] ?? node.type;
    return (Array.isArray(raw) ? raw : [raw])
      .filter((t) => typeof t === 'string')
      .map((t) => t.toLowerCase());
  };
  const product =
    nodes.find((n) => typesOf(n).some((t) => t === 'product' || t === 'productgroup')) || null;

  const nameOf = (value) => {
    if (typeof value === 'string') return clean(value);
    if (typeof value === 'number') return String(value);
    if (value && typeof value === 'object') return clean(value.name || value['@value'] || '');
    return null;
  };

  /* ── Meta tags ───────────────────────────────────────────────── */
  const meta = (key) => {
    const el = document.querySelector(
      `meta[property="${key}"], meta[name="${key}"], meta[itemprop="${key}"]`,
    );
    return el ? clean(el.getAttribute('content')) || null : null;
  };
  const metaAll = (key) =>
    [...document.querySelectorAll(`meta[property="${key}"], meta[name="${key}"]`)]
      .map((el) => clean(el.getAttribute('content')))
      .filter(Boolean);

  /* ── Price ───────────────────────────────────────────────────── */
  const numberFrom = (raw) => {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string') return null;
    const digits = raw.replace(/[^\d.,]/g, '');
    if (!/\d/.test(digits)) return null;
    const lastDot = digits.lastIndexOf('.');
    const lastComma = digits.lastIndexOf(',');
    let normalised = digits;
    if (lastDot >= 0 && lastComma >= 0) {
      const at = Math.max(lastDot, lastComma);
      normalised = digits.slice(0, at).replace(/[.,]/g, '') + '.' + digits.slice(at + 1);
    } else if (lastComma >= 0) {
      normalised =
        digits.length - lastComma - 1 === 2 ? digits.replace(',', '.') : digits.replace(/,/g, '');
    }
    const value = Number(normalised);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  };

  const offers = nodes.filter((n) => typesOf(n).some((t) => t.includes('offer')));
  const offerPrices = offers
    .map((o) => numberFrom(o.price ?? o.lowPrice ?? o.priceSpecification?.price))
    .filter((p) => p !== null);

  /*
   * When the page publishes no offer, read the price off the page the way a
   * person does. Struck-through numbers are collected separately: that is the
   * "was" price, and mistaking it for the real one is the classic way to
   * import everything at the wrong number.
   */
  const asking = [];
  const crossed = [];
  /*
   * The text the asking price was read out of, and the text around it. On a
   * page that publishes no currency anywhere, the symbol sitting in front of
   * the number is the only thing that says what this money is — so it is kept
   * rather than thrown away with the rest of the string.
   */
  const priceTexts = [];
  {
    const candidates = document.querySelectorAll(
      '[itemprop="price"], [data-price], [class*="price" i], [id*="price" i], del, s',
    );
    for (const el of [...candidates].slice(0, 60)) {
      if (el.closest('[hidden]') || el.offsetParent === null) continue;
      const raw = el.getAttribute('content') || el.getAttribute('data-price') || clean(el.textContent);
      if (!raw || raw.length > 40) continue;
      const value = numberFrom(raw);
      if (value === null) continue;
      const struck =
        el.closest('s, del, .compare-at, [class*="compare" i], [class*="was" i], [class*="strike" i]') !==
        null;
      // The numbers are only read off the page when there is no offer to read
      // them from; the text is always worth having, because an offer can name
      // a price without naming a currency.
      if (offerPrices.length === 0) (struck ? crossed : asking).push(value);
      if (struck) continue;
      priceTexts.push(
        clean(el.textContent).slice(0, 60),
        clean(el.parentElement ? el.parentElement.textContent : '').slice(0, 120),
      );
    }
  }

  const price = offerPrices.length ? Math.min(...offerPrices) : (asking[0] ?? null);
  const compareAt = crossed.length ? Math.max(...crossed) : null;

  /* ── Currency ────────────────────────────────────────────────
   *
   * Worth as much care as the number itself. The catalogue is in dollars and
   * almost nothing we import is, so a price read without its currency is how
   * ¥120 of yarn becomes a $120 product and the margin goes quietly the wrong
   * way. A page with structured data names the currency outright. A great many
   * shops — including most of the Chinese ones we buy from — name it nowhere
   * at all, and have only the symbol in front of the price.
   */
  const SYMBOL_CODES = [
    // Longest first: "US$" and "A$" both end in the sign for dollars, so a
    // plain "$" can only be tried once the qualified ones have been ruled out.
    ['US$', 'USD'],
    ['A$', 'AUD'],
    ['C$', 'CAD'],
    ['NZ$', 'NZD'],
    ['HK$', 'HKD'],
    ['NT$', 'TWD'],
    ['S$', 'SGD'],
    ['R$', 'BRL'],
    ['€', 'EUR'],
    ['£', 'GBP'],
    ['₫', 'VND'],
    ['₹', 'INR'],
    ['₩', 'KRW'],
    ['฿', 'THB'],
    ['₱', 'PHP'],
    ['₽', 'RUB'],
    ['₺', 'TRY'],
  ];

  /*
   * ¥ is both yuan and yen, and the page is the only tiebreaker there is. A
   * Japanese shop says so in its lang or its hostname; everything else pricing
   * in ¥ here is a Chinese supplier, which is nearly all of them. Guessing yen
   * for a yuan price would be worse than not converting: the rate is out by a
   * factor of twenty, and the figure would still look plausible.
   */
  const yenish =
    /^ja\b/i.test(document.documentElement.lang || '') || /\.jp$/i.test(location.hostname);

  // Only codes the shop might hold a rate for, so a stray "NEW" or "ADD" in a
  // price row cannot be mistaken for money.
  const CODE_PATTERN =
    /\b(USD|CNY|RMB|JPY|EUR|GBP|KRW|VND|INR|THB|PHP|HKD|TWD|SGD|MYR|IDR|CHF|SEK|NOK|DKK|PLN|TRY|RUB|AUD|CAD|NZD|AED|ZAR|BRL|MXN)\b/;

  /** A currency out of a scrap of price text, by its code or by its symbol. */
  const codeFrom = (value) => {
    const text = clean(value);
    if (!text) return null;
    // A written code beats a symbol: "US$ 12" and "USD 12" say which dollars
    // they mean, "$12" does not.
    const iso = text.toUpperCase().match(CODE_PATTERN);
    if (iso) return iso[1] === 'RMB' ? 'CNY' : iso[1];
    for (const [symbol, code] of SYMBOL_CODES) {
      if (text.includes(symbol)) return code;
    }
    if (/[¥￥]|元|人民币/.test(text)) return yenish ? 'JPY' : 'CNY';
    if (text.includes('$')) return 'USD';
    return null;
  };

  /** A code somebody declared, which arrives as "CNY", "cny" or ".../CNY". */
  const declared = (value) => {
    const name = nameOf(value);
    if (!name) return null;
    const code = name
      .replace(/^.*\//, '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3);
    return code.length === 3 ? code : null;
  };

  const currencyText =
    offers
      .map(
        (o) =>
          declared(o.priceCurrency) ||
          declared(o.priceSpecification && o.priceSpecification.priceCurrency),
      )
      .find(Boolean) ||
    declared(meta('product:price:currency')) ||
    declared(meta('og:price:currency')) ||
    declared(
      (document.querySelector('[itemprop="priceCurrency"]') || {}).getAttribute?.('content'),
    ) ||
    /*
     * Last, the price as it is printed. Deliberately not a sweep of the whole
     * page: a currency switcher offering "USD" on a page priced in yuan used
     * to be read as the price's own currency, which turned the conversion off
     * on exactly the pages that needed it most.
     */
    priceTexts.map(codeFrom).find(Boolean) ||
    null;

  /* ── Images ──────────────────────────────────────────────────── */
  const images = [];
  const addImage = (value) => {
    if (!value || typeof value !== 'string') return;
    if (/^data:/i.test(value) || /\.svg($|\?)/i.test(value)) return;
    if (/(logo|sprite|icon|placeholder|badge|payment)/i.test(value)) return;
    const url = absolute(value);
    // http(s) only: a resolved "javascript:" URL is a valid URL, and this list
    // is sent to the shop to be fetched and stored.
    if (!url || !/^https?:/i.test(url)) return;
    if (!images.includes(url)) images.push(url);
  };

  metaAll('og:image:secure_url').forEach(addImage);
  metaAll('og:image').forEach(addImage);
  if (product) {
    const raw = Array.isArray(product.image) ? product.image : [product.image];
    raw.forEach((entry) => addImage(typeof entry === 'string' ? entry : entry?.url || entry?.contentUrl));
  }

  // Then the biggest pictures actually on the page, largest first — on a
  // gallery that is the product from several angles.
  const onPage = [...document.images]
    .filter((img) => img.naturalWidth >= 300 && img.naturalHeight >= 300)
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
    .slice(0, 8);
  for (const img of onPage) {
    // srcset carries the full-size file where src is a thumbnail.
    const best = (img.getAttribute('srcset') || '')
      .split(',')
      .map((part) => part.trim().split(/\s+/))
      .filter((part) => part[0])
      .sort((a, b) => (parseInt(b[1] ?? '0', 10) || 0) - (parseInt(a[1] ?? '0', 10) || 0))[0];
    addImage(best?.[0] || img.currentSrc || img.src);
  }

  /* ── Everything else ─────────────────────────────────────────── */
  const heading = document.querySelector('h1');
  const name =
    (product && nameOf(product.name)) ||
    meta('og:title') ||
    clean(heading?.textContent) ||
    clean(document.title).split(/\s+[|–—·]\s+/)[0] ||
    null;

  const descriptionEl = document.querySelector(
    '[itemprop="description"], #product-description, .product-description, [class*="product" i][class*="description" i]',
  );
  const description =
    (product && nameOf(product.description)) ||
    clean(descriptionEl?.textContent)?.slice(0, 4000) ||
    meta('description') ||
    meta('og:description') ||
    null;

  const tags = [];
  const category = product ? nameOf(product.category) : null;
  if (category) tags.push(category);
  const keywords = meta('keywords');
  if (keywords) keywords.split(',').map(clean).filter(Boolean).slice(0, 6).forEach((t) => tags.push(t));

  return {
    url: location.href,
    siteName: meta('og:site_name') || location.hostname.replace(/^www\./, ''),
    name,
    description,
    price,
    currency: currencyText,
    compareAtPrice: compareAt,
    images: images.slice(0, 8),
    sku:
      (product && (nameOf(product.sku) || nameOf(product.mpn))) ||
      meta('product:retailer_item_id') ||
      null,
    brand: (product && nameOf(product.brand)) || meta('product:brand') || null,
    // schema.org spells this as a URL; the last segment is the useful part.
    availability:
      (offers.map((o) => nameOf(o.availability)).find(Boolean) || '').replace(/^.*\//, '') || null,
    tags: tags.slice(0, 10),
    // Told to the popup so a thin read is explicable rather than mysterious.
    via: product ? 'structured data' : price !== null ? 'the page itself' : 'the page (no price found)',
  };
}

/**
 * Every pin on a Pinterest board, as the browser currently has it.
 *
 * This is the half a server cannot do: Pinterest loads a board as you scroll,
 * so what is collectable is exactly what has been scrolled past. The popup
 * says so, because "it only got 30" is otherwise indistinguishable from a bug.
 */
export function collectPins() {
  const ids = [];
  for (const anchor of document.querySelectorAll('a[href*="/pin/"]')) {
    const match = (anchor.getAttribute('href') || '').match(/\/pin\/(\d{6,25})/);
    if (match && !ids.includes(match[1])) ids.push(match[1]);
  }
  return {
    urls: ids.map((id) => `https://www.pinterest.com/pin/${id}/`),
    title: document.title.replace(/\s*\|\s*Pinterest\s*$/i, '').trim(),
  };
}
