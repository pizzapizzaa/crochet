-- =========================================================
-- ZippyZack.com — POS Admin schema update
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is idempotent: safe to run on a fresh project OR on top of the
-- existing supabase/schema.sql, and safe to run more than once.
--
-- What it does:
--   1. Creates the `categories` table (managed from /pos/categories)
--   2. Adds `category_id` + `updated_at` to `products`
--   3. Keeps the denormalised `products.category` text in sync via triggers
--   4. Seeds the five launch categories and backfills existing products
--   5. Sets row-level security so the public site reads, and only the
--      service role (the POS server) writes
--   6. Creates the public `product-images` storage bucket
-- =========================================================

create extension if not exists "pgcrypto";

-- ── 0. Base tables (no-ops if you already ran schema.sql) ─────────────
create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  name              text not null,
  slug              text not null unique,
  description       text not null,
  price             numeric(10, 2) not null check (price >= 0),
  compare_at_price  numeric(10, 2) check (compare_at_price >= 0),
  category          text not null,
  tags              text[] not null default '{}',
  images            text[] not null default '{}',
  stock             integer not null default 0 check (stock >= 0),
  is_active         boolean not null default true,
  is_featured       boolean not null default false,
  yarn_weight       text,
  hook_size         text,
  dimensions        text,
  care_instructions text
);

-- ── 1. CATEGORIES ────────────────────────────────────────────────────
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  name          text not null unique,
  slug          text not null unique,
  description   text,
  image_url     text,
  display_order integer not null default 0,
  is_active     boolean not null default true
);

create index if not exists categories_order_idx  on public.categories (display_order, name);
create index if not exists categories_slug_idx   on public.categories (slug);
create index if not exists categories_active_idx on public.categories (is_active);

-- ── 2. PRODUCTS: new columns ─────────────────────────────────────────
alter table public.products
  add column if not exists category_id uuid references public.categories(id) on delete set null;

alter table public.products
  add column if not exists updated_at timestamptz not null default now();

create index if not exists products_slug_idx        on public.products (slug);
create index if not exists products_category_idx    on public.products (category);
create index if not exists products_category_id_idx on public.products (category_id);
create index if not exists products_active_idx      on public.products (is_active);
create index if not exists products_featured_idx    on public.products (is_featured) where is_active = true;

-- ── 3. SEED CATEGORIES ───────────────────────────────────────────────
-- `on conflict do nothing` means re-running never clobbers edits you have
-- made in the POS, whether the clash is on the name or the slug.
insert into public.categories (name, slug, description, display_order) values
  ('Yarn',     'yarn',     'Merino, cotton, macrame cord and everything else that comes on a ball.', 1),
  ('Kits',     'kits',     'A whole project in one box — yarn, hook, notions and the pattern.',      2),
  ('Tools',    'tools',    'Hooks, stitch markers, blocking mats and the small stuff that helps.',   3),
  ('Bundles',  'bundles',  'Curated yarn groupings picked so the colours sit together.',             4),
  ('Patterns', 'patterns', 'Printable and digital patterns, written and charted.',                   5)
on conflict do nothing;

-- ── 4. BACKFILL: link existing products to their category row ────────
update public.products p
   set category_id = c.id
  from public.categories c
 where p.category_id is null
   and lower(trim(p.category)) = lower(c.name);

-- Any product whose text category has no matching row gets one created,
-- so nothing in the shop is left orphaned.
insert into public.categories (name, slug, display_order)
select distinct
       trim(p.category),
       lower(regexp_replace(trim(p.category), '[^a-zA-Z0-9]+', '-', 'g')),
       99
  from public.products p
 where p.category_id is null
   and coalesce(trim(p.category), '') <> ''
on conflict do nothing;

update public.products p
   set category_id = c.id
  from public.categories c
 where p.category_id is null
   and lower(trim(p.category)) = lower(c.name);

-- ── 5. TRIGGERS ──────────────────────────────────────────────────────

-- 5a. touch updated_at on every write
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

drop trigger if exists categories_touch_updated_at on public.categories;
create trigger categories_touch_updated_at
  before update on public.categories
  for each row execute function public.touch_updated_at();

-- 5b. products.category (text) is a mirror of the linked category's name.
--     The storefront and ProductCard read the text column, the POS edits
--     the relation — this keeps the two from ever drifting apart.
create or replace function public.sync_product_category_name()
returns trigger
language plpgsql
as $fn$
begin
  if new.category_id is not null then
    select c.name into new.category
      from public.categories c
     where c.id = new.category_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists products_sync_category on public.products;
create trigger products_sync_category
  before insert or update of category_id on public.products
  for each row execute function public.sync_product_category_name();

-- 5c. renaming a category rewrites the mirror on all of its products
create or replace function public.sync_products_on_category_rename()
returns trigger
language plpgsql
as $fn$
begin
  if new.name is distinct from old.name then
    update public.products
       set category = new.name
     where category_id = new.id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists categories_rename_sync on public.categories;
create trigger categories_rename_sync
  after update on public.categories
  for each row execute function public.sync_products_on_category_rename();

-- ── 6. ROW LEVEL SECURITY ────────────────────────────────────────────
-- The public site uses the anon key and may only SELECT live rows.
-- The POS server uses the service-role key, which bypasses RLS entirely,
-- so no write policies are needed (and none are granted on purpose).
alter table public.products   enable row level security;
alter table public.categories enable row level security;

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
  on public.products for select
  using (is_active = true);

drop policy if exists "Public can read active categories" on public.categories;
create policy "Public can read active categories"
  on public.categories for select
  using (is_active = true);

-- ── 7. STORAGE: product-images bucket ────────────────────────────────
-- Public read so <img src> works; uploads happen server-side through the
-- POS with the service-role key.
--
-- Wrapped so a permissions error on storage.* cannot roll back sections 1-6.
-- If this block reports a notice, create the bucket by hand instead:
--   Dashboard → Storage → New bucket → name "product-images", Public → on.
do $storage$
begin
  insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do update set public = true;
exception when others then
  raise notice 'Could not create the product-images bucket (%). Create it in the Storage dashboard and mark it Public.', sqlerrm;
end;
$storage$;

do $storagepolicy$
begin
  drop policy if exists "Public can read product images" on storage.objects;
  create policy "Public can read product images"
    on storage.objects for select
    using (bucket_id = 'product-images');
exception when others then
  raise notice 'Could not set the storage read policy (%). A public bucket serves images without one, so this is usually fine.', sqlerrm;
end;
$storagepolicy$;

-- ── 8. Sanity check ──────────────────────────────────────────────────
-- select c.name, c.display_order, count(p.id) as products
--   from public.categories c
--   left join public.products p on p.category_id = c.id
--  group by c.id, c.name, c.display_order
--  order by c.display_order;
