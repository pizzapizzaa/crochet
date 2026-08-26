/*
 * One-off seed: loads the demo catalogue from src/lib/mockData.ts into
 * Supabase so a fresh project starts with a populated shop instead of an
 * empty one.
 *
 *   node --env-file=.env scripts/seed-products.mjs
 *   node --env-file=.env scripts/seed-products.mjs --dry-run
 *
 * Idempotent: products are matched on `slug`, so re-running updates the same
 * rows rather than duplicating them. Anything you have since edited in /pos
 * WILL be overwritten back to the demo values — that is the point of a seed,
 * but it means you only want to run this on a shop you have not curated yet.
 *
 * Categories are expected to exist already (supabase/pos-schema.sql seeds
 * them). A product whose category has no row is reported and skipped rather
 * than silently filed as uncategorised.
 */
import { createClient } from '@supabase/supabase-js';
import { mockProducts } from '../src/lib/mockData.ts';

const dryRun = process.argv.includes('--dry-run');

const url = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env scripts/seed-products.mjs');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

console.log(`project:  ${url}`);
console.log(`mode:     ${dryRun ? 'DRY RUN — nothing will be written' : 'writing'}`);

// ── categories ───────────────────────────────────────────────────────────
const { data: categories, error: catError } = await db.from('categories').select('id, name');

if (catError) {
  console.error(`\nCould not read categories: ${catError.message}`);
  console.error('Have you run supabase/pos-schema.sql?');
  process.exit(1);
}

const idByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
console.log(`\ncategories in database: ${categories.map((c) => c.name).join(', ')}`);

// ── build the rows ───────────────────────────────────────────────────────
const rows = [];
const skipped = [];

for (const p of mockProducts) {
  const categoryId = idByName.get(p.category.toLowerCase());
  if (!categoryId) {
    skipped.push(p);
    continue;
  }

  rows.push({
    // `id` is deliberately omitted — the mock ids ('1', '2', …) are not uuids,
    // so the database generates real ones. `slug` is the identity here.
    created_at: p.created_at,
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: p.price,
    compare_at_price: p.compare_at_price,
    category: p.category,
    category_id: categoryId,
    tags: p.tags,
    images: p.images,
    stock: p.stock,
    is_active: p.is_active,
    is_featured: p.is_featured,
    yarn_weight: p.yarn_weight,
    hook_size: p.hook_size,
    dimensions: p.dimensions,
    care_instructions: p.care_instructions,
  });
}

if (skipped.length) {
  console.log('\nSKIPPED — no matching category row:');
  for (const p of skipped) console.log(`  ${p.name}  (category "${p.category}")`);
}

const byCategory = rows.reduce((acc, r) => {
  acc[r.category] = (acc[r.category] ?? 0) + 1;
  return acc;
}, {});

console.log(`\nto seed: ${rows.length} products`);
for (const [name, n] of Object.entries(byCategory)) console.log(`  ${name.padEnd(10)} ${n}`);
console.log(`  ${'featured'.padEnd(10)} ${rows.filter((r) => r.is_featured).length}`);

// ── write ────────────────────────────────────────────────────────────────
// Note: no process.exit() on the happy path. Ending naturally lets the
// Supabase client close its handles, which avoids a libuv teardown assertion
// on Windows.
if (dryRun) {
  console.log('\nDry run — nothing written.');
} else {
  const { data, error } = await db
    .from('products')
    .upsert(rows, { onConflict: 'slug' })
    .select('id, slug');

  if (error) {
    console.error(`\nSeed failed: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.log(`\nUpserted ${data.length} products.`);

    const { count } = await db.from('products').select('*', { count: 'exact', head: true });
    const { count: liveCount } = await db
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    console.log(`Database now holds ${count} products (${liveCount} live).`);
  }
}
