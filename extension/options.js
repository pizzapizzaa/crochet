import { callShop, loadSettings, normaliseShopUrl, saveSettings } from './shared.js';

/*
 * Settings, and a Test button — because the two ways this goes wrong (wrong
 * address, wrong token) both look identical from the popup, and finding that
 * out mid-import is the worst time to find it out.
 */

const $ = (id) => document.getElementById(id);

function note(id, message, tone = 'muted') {
  const el = $(id);
  el.textContent = message;
  el.className = 'note' + (tone === 'ok' ? ' ok card' : tone === 'warn' ? ' warn card' : '');
}

function current() {
  return {
    shopUrl: $('shopUrl').value.trim(),
    token: $('token').value.trim(),
    categoryId: $('categoryId').value,
    markup: Math.max(0, Number($('markup').value) || 0),
    stock: Math.max(0, Math.round(Number($('stock').value) || 0)),
    publish: $('publish').checked,
  };
}

/** Fill the category list from the shop, keeping whatever was already chosen. */
async function loadCategories(settings, chosen) {
  const select = $('categoryId');
  const { categories } = await callShop(settings, '/api/pos/categories-list', {});
  select.length = 1;
  for (const category of categories ?? []) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name + (category.is_active ? '' : ' (hidden)');
    option.selected = chosen === category.id;
    select.appendChild(option);
  }
  return (categories ?? []).length;
}

$('test').addEventListener('click', async () => {
  const settings = current();
  if (!normaliseShopUrl(settings.shopUrl)) {
    note('test-note', 'That shop address is not a web address.', 'warn');
    return;
  }
  note('test-note', 'Asking the shop…');
  try {
    const count = await loadCategories(settings, settings.categoryId);
    note(
      'test-note',
      `Connected. ${count} categor${count === 1 ? 'y' : 'ies'} to file imports under.`,
      'ok',
    );
  } catch (error) {
    note('test-note', error.message, 'warn');
  }
});

$('save').addEventListener('click', async () => {
  const settings = current();
  if (settings.shopUrl && !normaliseShopUrl(settings.shopUrl)) {
    note('save-note', 'That shop address is not a web address.', 'warn');
    return;
  }
  await saveSettings({ ...settings, shopUrl: normaliseShopUrl(settings.shopUrl) });
  note('save-note', 'Saved.', 'ok');
});

(async () => {
  const settings = await loadSettings();
  $('shopUrl').value = settings.shopUrl;
  $('token').value = settings.token;
  $('markup').value = String(settings.markup ?? 0);
  $('stock').value = String(settings.stock ?? 0);
  $('publish').checked = Boolean(settings.publish);

  if (settings.shopUrl && settings.token) {
    try {
      await loadCategories(settings, settings.categoryId);
    } catch {
      // The Test button says why; a silent failure on open is fine.
    }
  }
})();
