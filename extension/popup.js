import {
  callShop,
  convertToUsd,
  formatSource,
  loadRates,
  loadSettings,
  money,
  normaliseShopUrl,
} from './shared.js';
import { collectPins, readProduct } from './readers.js';

/*
 * One popup, three situations: nothing configured yet, a Pinterest board, or
 * anything else — which is treated as a product page and read as one.
 *
 * The page is read the moment the popup opens, so by the time the panel has
 * drawn there is nothing left to do but press Import. That is the "one click"
 * this is for: the reading, the pricing and the photographs are already done.
 */

const $ = (id) => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);

let settings = null;
let tab = null;
let scraped = null;

// What the conversion did to this page's price, kept so the import can record
// the rate on the product rather than leaving a margin nobody can explain.
let fxUsed = null;

const isPinterest = (url) => {
  try {
    return /(^|\.)pinterest\.[a-z.]+$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** Run one of the readers inside the page the tab is showing. */
async function readPage(fn) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fn });
  return result?.result ?? null;
}

function say(id, message, tone = 'muted') {
  const el = $(id);
  el.textContent = message;
  el.className = 'note' + (tone === 'ok' ? ' ok card' : tone === 'warn' ? ' warn card' : '');
}

/* ── Products ───────────────────────────────────────────────────── */

async function fillCategories() {
  const select = $('category');
  try {
    const { categories } = await callShop(settings, '/api/pos/categories-list', {});
    for (const category of categories ?? []) {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name + (category.is_active ? '' : ' (hidden)');
      option.selected = settings.categoryId === category.id;
      select.appendChild(option);
    }
  } catch (error) {
    // Not fatal: the shop files an uncategorised import in its holding pen.
    say('product-note', `Categories did not load — ${error.message}`, 'warn');
  }
}

async function setUpProduct() {
  show('product', true);
  scraped = await readPage(readProduct);

  if (!scraped || !scraped.name) {
    $('subtitle').textContent = 'Nothing product-shaped on this page.';
    say(
      'product-note',
      'No product name was found here. If this is a product page, it may build itself after a moment — reload it and try again.',
      'warn',
    );
    $('import').disabled = true;
    return;
  }

  $('subtitle').textContent = `Read from ${scraped.siteName} — via ${scraped.via}.`;
  $('product-name').textContent = scraped.name;

  /*
   * Built as nodes, never as a string of HTML. Every value here was read off
   * somebody else's website, and this popup is a privileged page — it can
   * reach chrome.storage, where the shop's import token lives. A product name
   * with a tag in it is not going to get a script into this document.
   */
  /*
   * The supplier's price, in dollars. Everything downstream of this — the box
   * the shop owner edits, the cost, what gets posted — is USD, so the
   * conversion happens once, here, and is shown rather than hidden.
   */
  const rates = await loadRates(settings);
  const fx = convertToUsd(scraped.price, scraped.currency, rates);
  const foreign = Boolean(scraped.currency && scraped.currency !== 'USD');
  const usdPrice = fx ? fx.usd : scraped.price;

  const meta = $('product-meta');
  meta.textContent = '';
  const pricePart = fx
    ? `${formatSource(fx.source, fx.code)} → ${money(fx.usd)}`
    : scraped.price !== null
      ? money(scraped.price)
      : 'no price found';

  const parts = [
    pricePart,
    // Only worth a pill when we could not do the sum; a converted price says
    // what it came from already.
    foreign && !fx ? `${scraped.currency} — not converted` : null,
    scraped.images.length
      ? `${scraped.images.length} photo${scraped.images.length === 1 ? '' : 's'}`
      : 'no photos',
    scraped.sku ? `SKU ${scraped.sku}` : null,
  ].filter(Boolean);

  parts.forEach((part, i) => {
    if (i > 0) meta.appendChild(document.createTextNode(' · '));
    const span = document.createElement('span');
    if (foreign && !fx && part.startsWith(scraped.currency)) span.className = 'pill';
    span.textContent = part;
    meta.appendChild(span);
  });

  if (scraped.images[0]) {
    // An <img> rather than a CSS background: no string ends up inside a
    // stylesheet, so there is nothing for a hostile URL to escape out of.
    const thumb = $('thumb');
    thumb.textContent = '';
    const img = document.createElement('img');
    img.src = scraped.images[0];
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.onerror = () => {
      thumb.textContent = 'Photo will not load';
    };
    thumb.appendChild(img);
  }

  // A markup means the shop's price is our cost and we sell it for more. Both
  // figures are in dollars by this point.
  const markup = Number(settings.markup) || 0;
  if (usdPrice !== null) {
    $('price').value = (Math.round(usdPrice * (1 + markup / 100) * 100) / 100).toFixed(2);
    if (markup > 0) $('cost').value = usdPrice.toFixed(2);
  }
  $('stock').value = String(settings.stock ?? 0);
  $('publish').checked = Boolean(settings.publish);

  // Remember what it cost them and in what, so the import can record the rate
  // on the product rather than leaving a margin nobody can explain later.
  fxUsed = fx;

  if (scraped.price === null) {
    say('product-note', 'No price was on the page — type one in before importing.', 'warn');
  } else if (fx) {
    say('product-note', `Converted at ${fx.rate} ${fx.code} to the dollar. Check it looks right.`, 'ok');
  } else if (foreign) {
    say(
      'product-note',
      `This page prices in ${scraped.currency} and your shop has no rate for it. The figure above is NOT converted — add ${scraped.currency} to FX_RATES, or type the dollar price in yourself.`,
      'warn',
    );
  }

  await fillCategories();
}

$('import').addEventListener('click', async () => {
  const price = Number($('price').value);
  if (!Number.isFinite(price) || price < 0) {
    say('product-note', 'Give it a price first.', 'warn');
    return;
  }

  $('import').disabled = true;
  $('import').textContent = 'Importing…';
  say('product-note', 'Sending it over, and copying the photographs…');

  try {
    const cost = $('cost').value === '' ? null : Number($('cost').value);
    const result = await callShop(settings, '/api/pos/product-import', {
      browser: scraped,
      url: scraped.url,
      siteName: scraped.siteName,
      name: scraped.name,
      description: scraped.description,
      price,
      costPrice: cost,
      /*
       * Converted here too. It was read off the same page in the same currency
       * as the price, and sending one in dollars beside the other in yuan is
       * how a "was ¥180" ends up as a $180 strike-through over a $16 product.
       */
      compareAtPrice: fxUsed
        ? (convertToUsd(scraped.compareAtPrice, scraped.currency, await loadRates(settings))?.usd ??
          null)
        : scraped.compareAtPrice,
      currency: scraped.currency,
      /*
       * Everything above is already dollars, and the shop owner may have
       * edited the box since. Without this flag the shop converts again on the
       * way in — which is deliberate, and what keeps an older copy of this
       * extension from filing raw yuan as dollars.
       */
      converted: true,
      sourcePrice: scraped.price,
      sku: scraped.sku,
      images: scraped.images,
      tags: scraped.tags,
      categoryId: $('category').value || undefined,
      stock: Math.max(0, Math.round(Number($('stock').value) || 0)),
      publish: $('publish').checked,
    });

    const shop = normaliseShopUrl(settings.shopUrl);
    const link = shop + (result.editUrl ?? '/pos/products');

    if (result.duplicate) {
      $('import').textContent = 'Already imported';
      say('product-note', result.note ?? 'That link is already in the catalogue.', 'warn');
    } else {
      $('import').textContent = 'Imported ✓';
      const warnings = (result.warnings ?? []).join(' ');
      say(
        'product-note',
        `Saved as ${result.published ? 'live' : 'a draft'} in ${result.category}. ` +
          `${result.imagesMirrored} of ${result.imageCount} photos copied across. ${warnings}`,
        warnings ? 'warn' : 'ok',
      );
    }

    const open = document.createElement('button');
    open.className = 'secondary';
    open.style.marginTop = '8px';
    open.textContent = 'Open it in the POS';
    open.addEventListener('click', () => chrome.tabs.create({ url: link }));
    $('product').appendChild(open);
  } catch (error) {
    $('import').disabled = false;
    $('import').textContent = 'Import to my shop';
    say('product-note', error.message, 'warn');
  }
});

/* ── Pinterest ──────────────────────────────────────────────────── */

let pins = [];

async function countPins() {
  const found = await readPage(collectPins);
  pins = found?.urls ?? [];
  $('pin-count').textContent =
    pins.length === 0
      ? 'No pins visible yet'
      : `${pins.length} pin${pins.length === 1 ? '' : 's'} on this page`;
  $('send-pins').disabled = pins.length === 0;
  $('send-pins').textContent =
    pins.length === 0 ? 'Send pins to ZippyZack' : `Send ${pins.length} pins to ZippyZack`;
  $('subtitle').textContent = found?.title ? `Pinterest — ${found.title}` : 'Pinterest';
}

async function setUpPinterest() {
  show('pinterest', true);
  await countPins();
}

$('recount').addEventListener('click', countPins);

$('send-pins').addEventListener('click', () => {
  const shop = normaliseShopUrl(settings.shopUrl);
  if (!shop) {
    say('pin-note', 'Set your shop address in settings first.', 'warn');
    return;
  }
  /*
   * Handed to the POS import screen rather than imported outright: a make
   * cannot be saved without a credited author, and that is a decision for a
   * person looking at the pins, not for a button in a popup.
   */
  const url = `${shop}/pos/makes/import?pins=${encodeURIComponent(pins.join(','))}`;
  chrome.tabs.create({ url });
  window.close();
});

/* ── Boot ───────────────────────────────────────────────────────── */

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('settings-link').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
$('shop-link').addEventListener('click', (event) => {
  event.preventDefault();
  const shop = normaliseShopUrl(settings?.shopUrl);
  if (shop) chrome.tabs.create({ url: shop + '/pos' });
});

(async () => {
  settings = await loadSettings();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!normaliseShopUrl(settings.shopUrl) || !settings.token) {
    $('subtitle').textContent = 'Not connected to a shop yet.';
    show('setup', true);
    return;
  }

  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    $('subtitle').textContent = 'Nothing to read on this tab.';
    show('idle', true);
    return;
  }

  try {
    if (isPinterest(tab.url)) await setUpPinterest();
    else await setUpProduct();
  } catch (error) {
    $('subtitle').textContent = 'Could not read this page.';
    show('idle', true);
    $('idle').textContent =
      error.message +
      ' Chrome will not let an extension read its own pages, the Web Store, or a PDF.';
  }
})();
