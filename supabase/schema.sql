-- =========================================================
-- Loopy & Co. — Supabase Database Schema
-- Run this in your Supabase SQL editor to set up all tables
-- =========================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── PRODUCTS ──────────────────────────────────────────────
create table public.products (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text not null,
  slug            text not null unique,
  description     text not null,
  price           numeric(10, 2) not null check (price >= 0),
  compare_at_price numeric(10, 2) check (compare_at_price >= 0),
  category        text not null,
  tags            text[] not null default '{}',
  images          text[] not null default '{}',
  stock           integer not null default 0 check (stock >= 0),
  is_active       boolean not null default true,
  is_featured     boolean not null default false,
  yarn_weight     text,
  hook_size       text,
  dimensions      text,
  care_instructions text
);

-- Index for fast slug lookups
create index products_slug_idx on public.products (slug);
create index products_category_idx on public.products (category);
create index products_featured_idx on public.products (is_featured) where is_active = true;

-- ── GALLERY ITEMS ─────────────────────────────────────────
create table public.gallery_items (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  title         text not null,
  description   text,
  image_url     text not null,
  alt_text      text not null,
  product_id    uuid references public.products(id) on delete set null,
  is_featured   boolean not null default false,
  display_order integer not null default 0
);

create index gallery_order_idx on public.gallery_items (display_order);

-- ── ORDERS ────────────────────────────────────────────────
create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  customer_email    text not null,
  customer_name     text not null,
  items             jsonb not null,
  total             numeric(10, 2) not null check (total >= 0),
  status            text not null default 'pending'
                      check (status in ('pending','processing','shipped','delivered','cancelled')),
  shipping_address  jsonb not null,
  stripe_session_id text
);

create index orders_email_idx on public.orders (customer_email);
create index orders_status_idx on public.orders (status);

-- ── ROW LEVEL SECURITY ────────────────────────────────────
-- Products: public read, admin write
alter table public.products enable row level security;
create policy "Public can read active products"
  on public.products for select
  using (is_active = true);

-- Gallery: public read
alter table public.gallery_items enable row level security;
create policy "Public can read gallery"
  on public.gallery_items for select
  using (true);

-- Orders: only service role can read/write (no public access)
alter table public.orders enable row level security;
-- (Orders are written via server-side API using the service role key)

-- ── STORAGE BUCKET ──────────────────────────────────────
-- Create via Supabase Dashboard: Storage → New Bucket → "product-images"
-- Set to Public so image URLs work directly in <img> tags.
-- Recommended: enable image transformations (Supabase Pro feature).
