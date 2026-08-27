-- =========================================================
-- ZippyZack.com — "Makes" (Pinterest projects) + material costing
--
-- Run this in the Supabase SQL editor AFTER supabase/pos-schema.sql.
-- Idempotent: safe to run more than once.
--
-- What it does:
--   1. Adds cost/supplier columns to `products` (the /pos/materials page)
--   2. Creates `makes` — a project sourced from a Pinterest pin, with the
--      pin's author kept alongside it for attribution
--   3. Creates `make_items` — the bundle of yarn and tools that make it
--   4. Adds a `make_bundle_totals` view so the storefront can price a bundle
--      in one round trip
--   5. Row-level security: public reads live rows, the POS service role writes
--
-- We do not sell the finished object and we do not host the pattern. A make is
-- a pointer at somebody else's pin plus the shopping list to recreate it, so
-- `pinterest_url` and the author fields are NOT NULL on purpose — attribution
-- is a data constraint, not a convention.
-- =========================================================

create extension if not exists "pgcrypto";

-- ── 1. PRODUCTS: what a material costs us ────────────────────────────
alter table public.products add column if not exists cost_price      numeric(10, 2) check (cost_price >= 0);
alter table public.products add column if not exists supplier_name   text;
alter table public.products add column if not exists supplier_url    text;
alter table public.products add column if not exists supplier_sku    text;
alter table public.products add column if not exists cost_note       text;
alter table public.products add column if not exists units_sold      integer not null default 0 check (units_sold >= 0);
alter table public.products add column if not exists cost_updated_at timestamptz;

comment on column public.products.cost_price is 'What one unit costs us landed, before we mark it up.';
comment on column public.products.units_sold is 'Units sold to date, entered by hand on /pos/materials until orders are wired up.';

-- Stamp cost_updated_at only when the cost actually moves, so the materials
-- page can show "priced 3 weeks ago" without every unrelated edit resetting it.
create or replace function public.touch_cost_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  if new.cost_price is distinct from old.cost_price then
    new.cost_updated_at = now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists products_touch_cost on public.products;
create trigger products_touch_cost
  before update on public.products
  for each row execute function public.touch_cost_updated_at();

-- ── 2. MAKES ─────────────────────────────────────────────────────────
create table if not exists public.makes (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  title               text not null,
  slug                text not null unique,
  summary             text,

  -- Source. Everything below this line exists so credit travels with the make.
  pinterest_url       text not null,
  pinterest_pin_id    text,
  author_name         text not null,
  author_url          text,
  attribution_note    text,

  -- Image lifted from the pin. `image_url` is our mirrored copy (Pinterest
  -- rotates its CDN paths), `source_image_url` is where it came from.
  image_url           text,
  source_image_url    text,

  difficulty          text check (difficulty in ('Beginner','Easy','Intermediate','Advanced')),
  estimated_time      text,

  -- Null bundle_price means "add the items up". A number overrides that.
  bundle_price        numeric(10, 2) check (bundle_price >= 0),
  bundle_discount_pct numeric(5, 2) not null default 0
                        check (bundle_discount_pct >= 0 and bundle_discount_pct < 100),

  tags                text[] not null default '{}',
  display_order       integer not null default 0,
  is_active           boolean not null default true,
  is_featured         boolean not null default false
);

create index if not exists makes_slug_idx     on public.makes (slug);
create index if not exists makes_active_idx   on public.makes (is_active);
create index if not exists makes_order_idx    on public.makes (display_order, created_at desc);
create index if not exists makes_featured_idx on public.makes (is_featured) where is_active = true;

drop trigger if exists makes_touch_updated_at on public.makes;
create trigger makes_touch_updated_at
  before update on public.makes
  for each row execute function public.touch_updated_at();

-- ── 3. MAKE ITEMS — the shopping list ────────────────────────────────
-- on delete restrict: a product that is part of a live bundle must be pulled
-- out of the bundle before it can be deleted, otherwise the make silently
-- loses a material and prices itself wrong.
create table if not exists public.make_items (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  make_id       uuid not null references public.makes(id)    on delete cascade,
  product_id    uuid not null references public.products(id) on delete restrict,
  quantity      numeric(10, 2) not null default 1 check (quantity > 0),
  note          text,
  is_optional   boolean not null default false,
  display_order integer not null default 0,
  unique (make_id, product_id)
);

create index if not exists make_items_make_idx    on public.make_items (make_id, display_order);
create index if not exists make_items_product_idx on public.make_items (product_id);

-- ── 4. BUNDLE TOTALS VIEW ────────────────────────────────────────────
-- Required items priced at today's product price. Optional extras are summed
-- separately so the storefront can show "+ $12 of optional extras".
create or replace view public.make_bundle_totals as
select
  m.id as make_id,
  coalesce(sum(mi.quantity * p.price) filter (where not mi.is_optional), 0)::numeric(10, 2) as items_subtotal,
  coalesce(sum(mi.quantity * p.price) filter (where mi.is_optional),     0)::numeric(10, 2) as optional_subtotal,
  coalesce(sum(mi.quantity * p.cost_price) filter (where not mi.is_optional), 0)::numeric(10, 2) as items_cost,
  count(mi.id) filter (where not mi.is_optional) as required_count,
  count(mi.id) filter (where mi.is_optional)     as optional_count
from public.makes m
left join public.make_items mi on mi.make_id = m.id
left join public.products   p  on p.id = mi.product_id and p.is_active
group by m.id;

-- ── 5. ROW LEVEL SECURITY ────────────────────────────────────────────
alter table public.makes      enable row level security;
alter table public.make_items enable row level security;

drop policy if exists "Public can read active makes" on public.makes;
create policy "Public can read active makes"
  on public.makes for select
  using (is_active = true);

-- Items are only readable through a make that is itself live.
drop policy if exists "Public can read items of active makes" on public.make_items;
create policy "Public can read items of active makes"
  on public.make_items for select
  using (exists (select 1 from public.makes m where m.id = make_id and m.is_active));

-- The view inherits the policies of the tables underneath it.
alter view public.make_bundle_totals set (security_invoker = on);

-- ── 6. Sanity check ──────────────────────────────────────────────────
-- select m.title, t.required_count, t.items_subtotal, m.bundle_price
--   from public.makes m join public.make_bundle_totals t on t.make_id = m.id
--  order by m.display_order;
