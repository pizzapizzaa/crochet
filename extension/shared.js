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
