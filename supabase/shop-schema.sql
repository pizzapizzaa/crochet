-- =========================================================
-- ZippyZack.com — Storefront checkout schema
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is idempotent: safe on a fresh project, safe on top of schema.sql and
-- pos-schema.sql, and safe to run more than once.
--
-- ⚠ RUN fulfilment-schema.sql AFTER THIS ONE, ALWAYS.
-- The commit_order below is the earlier version: it knows nothing about
-- stock_committed and does its stock loop inline. fulfilment-schema.sql
-- replaces it with one that records whether stock was really drawn, which the
-- restock and refund tooling depends on. Re-running this file on its own would
-- quietly put the old version back.
--
-- What it does:
--   1. Creates `orders` if it is missing, then adds the checkout columns
--   2. Adds a human order number and the ids a payment is traced by
--   3. Creates commit_order(), which takes payment and stock in ONE
--      transaction so a paid order can never draw stock that is gone
-- =========================================================

create extension if not exists "pgcrypto";

-- ── 0. Base table (a no-op if you already ran schema.sql) ─────────────
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  customer_email    text not null,
  customer_name     text not null,
  items             jsonb not null,
  total             numeric(10, 2) not null check (total >= 0),
  status            text not null default 'pending'
                      check (status in ('pending','processing','shipped','delivered','cancelled')),
  shipping_address  jsonb not null
);

-- ── 1. CHECKOUT COLUMNS ──────────────────────────────────────────────
-- order_number is what the customer quotes back to us; it is the lookup key
-- for /orders/track, so it is unique and never reused.
alter table public.orders add column if not exists order_number      text;
alter table public.orders add column if not exists updated_at        timestamptz not null default now();
alter table public.orders add column if not exists subtotal          numeric(10, 2) not null default 0;
alter table public.orders add column if not exists shipping_total    numeric(10, 2) not null default 0;
alter table public.orders add column if not exists payment_status    text not null default 'unpaid';
alter table public.orders add column if not exists customer_note     text;
alter table public.orders add column if not exists paid_at           timestamptz;

-- Payment columns are deliberately provider-neutral. payOS is the only one
-- wired up today, but a card provider for international customers is expected
-- to land beside it, and renaming columns later is how live orders get lost.
alter table public.orders add column if not exists payment_provider  text not null default 'payos';
alter table public.orders add column if not exists provider_order_code bigint;
alter table public.orders add column if not exists provider_payment_id text;
alter table public.orders add column if not exists payment_reference text;
alter table public.orders add column if not exists amount_charged    numeric(14, 2);
alter table public.orders add column if not exists charged_currency  text;

-- Shipping address is collected on our own checkout page, so a row that
-- predates it still needs something in a not-null jsonb column.
alter table public.orders alter column shipping_address set default '{}'::jsonb;

-- Backfill any rows that predate the column before it goes not-null.
update public.orders
   set order_number = 'ZZ-' || upper(substr(replace(id::text, '-', ''), 1, 6))
 where order_number is null;

alter table public.orders alter column order_number set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_order_number_key') then
    alter table public.orders add constraint orders_order_number_key unique (order_number);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_provider_order_code_key') then
    alter table public.orders add constraint orders_provider_order_code_key unique (provider_order_code);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_check') then
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status in ('unpaid','paid','failed','refunded'));
  end if;
end $$;

create index if not exists orders_number_idx  on public.orders (order_number);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_provider_code_idx on public.orders (provider_order_code);

comment on column public.orders.items is
  'Snapshot of the basket: { lines: [...what the customer saw...], units: [{product_id, quantity}] }. '
  'lines is for display and never re-priced; units is what stock is drawn from.';
comment on column public.orders.order_number is
  'Human-quotable code (ZZ-7K3P9M). With customer_email it is the whole auth model for order tracking.';
comment on column public.orders.provider_order_code is
  'payOS needs an integer to identify a payment; ZZ-7K3P9M is letters, so a number is drawn alongside it.';
comment on column public.orders.amount_charged is
  'What was actually taken, in charged_currency. The catalogue is USD and payOS settles in VND, so this records the converted figure that hit the bank rather than leaving it to be recomputed at a later rate.';

-- ── 2. UPDATED_AT ────────────────────────────────────────────────────
create or replace function public.touch_orders_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_orders_updated_at();

-- ── 3. COMMIT AN ORDER ───────────────────────────────────────────────
-- Called once the payment provider reports the money taken. Marking the order
-- paid, drawing
-- down stock and crediting units_sold have to happen together: three separate
-- round trips from an API route is how a payment gets taken against stock
-- somebody else bought thirty milliseconds earlier.
--
-- It is called from two places that race by design — the webhook and the
-- customer landing back on the receipt — so the paid check below is what keeps
-- a single payment from drawing stock twice.
--
-- Stock is decremented with a guarded update, so losing that race fails loudly
-- here rather than quietly selling the same last skein to two people. If it
-- raises, the caller has a captured payment and an uncommitted order — which is
-- the pair of facts a human needs to refund or restock, and better than either
-- fact alone.
create or replace function public.commit_order(p_order_id uuid, p_payment_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  unit    jsonb;
  touched integer;
begin
  -- Idempotent: a retried webhook must not draw stock down a second time.
  if exists (select 1 from public.orders where id = p_order_id and payment_status = 'paid') then
    return;
  end if;

  for unit in
    select jsonb_array_elements(items -> 'units') from public.orders where id = p_order_id
  loop
    update public.products
       set stock      = stock - (unit ->> 'quantity')::integer,
           units_sold = units_sold + (unit ->> 'quantity')::integer
     where id = (unit ->> 'product_id')::uuid
       and stock >= (unit ->> 'quantity')::integer;

    get diagnostics touched = row_count;
    if touched = 0 then
      raise exception 'Not enough stock for product % (wanted %)',
        unit ->> 'product_id', unit ->> 'quantity'
        using errcode = 'check_violation';
    end if;
  end loop;

  update public.orders
     set payment_status           = 'paid',
         payment_reference        = coalesce(nullif(p_payment_ref, ''), payment_reference),
         paid_at                  = now()
   where id = p_order_id;
end $$;

-- ── 4. ROW LEVEL SECURITY ────────────────────────────────────────────
-- Orders stay closed to the public key entirely. Every read and write goes
-- through a server route holding the service-role key, which bypasses RLS.
-- The storefront never queries this table from the browser.
alter table public.orders enable row level security;
