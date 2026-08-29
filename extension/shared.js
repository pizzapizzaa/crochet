/*
 * Settings, and the one way this extension talks to a shop.
 *
 * Everything the popup and the options page both need lives here. The token
 * travels in the request body rather than an Authorization header on purpose:
 * a header makes the request "not simple" in CORS terms, which puts a
 * preflight in front of every call, and whether a preflight is answered
 * correctly depends on how the shop happens to be hosted. The body works
 * everywhere. The shop accepts either.
 */

export const DEFAULTS = {
  shopUrl: '',
  token: '',
  categoryId: '',
  markup: 0,
  stock: 0,
  publish: false,
};

export async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(values) {
  await chrome.storage.sync.set(values);
}

/** Trailing slashes and stray paths are the usual way this gets typed wrong. */
export function normaliseShopUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
  try {
    const url = new URL(withScheme);
    return url.origin;
  } catch {
    return '';
  }
}

/**
 * POST to the shop. Content-Type is text/plain so the request stays a CORS
 * simple request; the shop reads the body as JSON regardless of what it is
 * labelled, which is what makes that safe to do.
 */
export async function callShop(settings, path, payload) {
  const base = normaliseShopUrl(settings.shopUrl);
  if (!base) throw new Error('Set your shop address in the extension options first.');
  if (!settings.token) throw new Error('Set your import token in the extension options first.');

  let res;
  try {
    res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...payload, token: settings.token }),
    });
  } catch {
    throw new Error(`Could not reach ${base}. Check the shop address and that the site is up.`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`${base} answered ${res.status} with something that was not JSON.`);
  }
  if (!res.ok) throw new Error(json.error || `The shop answered ${res.status}.`);
  return json;
}

export const money = (value) =>
  value === null || value === undefined
    ? '—'
    : '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/*
 * ── CURRENCY ────────────────────────────────────────────────────────────────
 *
 * Nearly every shop we import from quotes something other than dollars — the
 * yarn is Chinese and priced in yuan — and the catalogue is USD only. Putting
 * the raw number in a box labelled "$" is how ¥120 becomes a $120 product and
 * the margin goes quietly the wrong way.
 *
 * The rates come from the shop rather than living here, because this extension
 * is loaded unpacked and never updates itself: a rate baked in today is still
 * baked in next year. Fetched once per popup and cached for the life of it.
 */

const SYMBOLS = {
  USD: '$', CNY: '¥', JPY: '¥', EUR: '€', GBP: '£',
  KRW: '₩', VND: '₫', INR: '₹', THB: '฿', PHP: '₱',
};

let ratesCache = null;

export async function loadRates(settings) {
  if (ratesCache) return ratesCache;
  try {
    const { rates } = await callShop(settings, '/api/pos/fx', {});
    ratesCache = rates && typeof rates === 'object' ? rates : {};
  } catch {
    // Not fatal. Without rates the popup shows the source figure as it found
    // it, says so, and lets the shop convert on import — which it will,
    // because the price is sent flagged as unconverted.
    ratesCache = {};
  }
  return ratesCache;
}

export const normaliseCode = (code) =>
  typeof code === 'string' ? code.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) : '';

/** "¥120.00" where the symbol is known, "120.00 SEK" where it is not. */
export function formatSource(amount, code) {
  const figure = Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return SYMBOLS[code] ? `${SYMBOLS[code]}${figure}` : `${figure} ${code}`;
}

/**
 * The source price in USD, or null when there is nothing to do — already
 * dollars, no price, or a currency the shop holds no rate for. Null always
 * means "leave it alone", never "it is zero".
 */
export function convertToUsd(amount, currency, rates) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  const code = normaliseCode(currency);
  if (!code || code === 'USD') return null;
  const rate = rates?.[code];
  if (!rate || !Number.isFinite(rate)) return null;
  return { usd: Math.round(amount * rate * 100) / 100, rate, code, source: amount };
}
