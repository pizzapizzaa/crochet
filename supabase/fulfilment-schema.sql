-- =========================================================
-- ZippyZack.com — Fulfilment schema
--
-- Run this in the Supabase SQL editor AFTER shop-schema.sql.
-- It is idempotent: safe on a fresh project and safe to run more than once.
--
-- shop-schema.sql got money in. This one is about everything that happens
-- afterwards — the parcel, the paper trail, and the handful of situations a
-- human has to step into.
--
-- What it does:
--   1. Records where a parcel actually is: carrier, tracking, and a timestamp
--      per step rather than one status word that forgets when it changed
--   2. Adds order_events, an append-only history of everything done to an order
--   3. Splits operational warnings out of customer_note into their own flag,
--      so the customer's words and our notes stop sharing a field
--   4. Tracks whether stock was really drawn, which is the fact a restock or a
--      refund has to turn on
--   5. Gives an abandoned checkout an expiry, so unpaid rows stop piling up
-- =========================================================

create extension if not exists "pgcrypto";

-- ── 1. WHERE THE PARCEL IS ───────────────────────────────────────────
-- A status word alone cannot answer "you said it shipped — when?", and
-- updated_at is overwritten by the next edit, so each step gets stamped as it
-- happens. These are set by the status route, never by hand.
alter table public.orders add column if not exists shipped_at      timestamptz;
alter table public.orders add column if not exists delivered_at    timestamptz;
alter table public.orders add column if not exists cancelled_at    timestamptz;

-- Carrier and tracking are optional on purpose: some of these are handed over
-- in person in Binh Loi Trung, and a required field would be filled with junk.
alter table public.orders add column if not exists carrier         text;
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists tracking_url    text;

-- Couriers here will not deliver without a number to call.
alter table public.orders add column if not exists customer_phone  text;

comment on column public.orders.tracking_url is
  'Where the customer can follow the parcel. Built from the carrier when that carrier is known, '
  'pasted in by hand otherwise — so a courier we have never used still works.';

-- ── 2. REFUNDS ───────────────────────────────────────────────────────
-- payOS does not reverse a VietQR transfer, so a refund is a bank transfer
-- made by hand. These columns are the record that it happened; the money moves
-- in a banking app, not here.
alter table public.orders add column if not exists refunded_at       timestamptz;
alter table public.orders add column if not exists refund_reference  text;

-- ── 3. WHAT NEEDS A HUMAN ────────────────────────────────────────────
-- This used to be appended to customer_note, which meant our operational
-- warnings and the customer's own words shared one field and the only way to
-- find a broken order was a substring search for a warning emoji.
alter table public.orders add column if not exists needs_attention  boolean not null default false;
alter table public.orders add column if not exists attention_reason text;

-- Whether commit_order actually drew this order's units off the shelf.
-- Restocking is only meaningful when it did: if commit_order raised, its
-- transaction rolled back and nothing moved, so "put it back" would invent
-- stock that was never taken.
alter table public.orders add column if not exists stock_committed  boolean not null default false;

comment on column public.orders.stock_committed is
  'True once commit_order has drawn this order''s units down. The precondition for restock_order — '
  'a paid order whose commit failed never took stock, so it has none to give back.';

-- ── 4. ABANDONED CHECKOUTS ───────────────────────────────────────────
-- An order row is written before the customer reaches payOS, so an abandoned
-- checkout leaves an unpaid row behind. That is the right trade — a payment
-- must never arrive with nothing to attach it to — but without an expiry those
-- rows accumulate for the life of the shop and the "not paid" tab becomes
-- noise. The payment link itself expires; this records when.
alter table public.orders add column if not exists payment_expires_at timestamptz;

-- ── 5. BACKFILL ──────────────────────────────────────────────────────
-- Orders placed before these columns existed still have to be truthful.

-- Anything already paid drew its stock through commit_order, unless it is one
-- of the flagged failures — those are exactly the ones whose commit rolled back.
update public.orders
   set stock_committed = true
 where payment_status = 'paid'
   and stock_committed = false
   and coalesce(customer_note, '') not like '%Stock not adjusted%';

-- Lift the old inline warnings out of customer_note into the flag built for
-- them. The note text is left alone: it is a record of what happened and
-- rewriting history to tidy a column is not worth the risk.
update public.orders
   set needs_attention  = true,
       attention_reason = 'Payment landed but stock could not be drawn down. See the order note.'
 where coalesce(customer_note, '') like '%Stock not adjusted%'
   and needs_attention = false;

update public.orders
   set needs_attention  = true,
       attention_reason = 'The transfer was for less than the order total. See the order note.'
 where coalesce(customer_note, '') like '%Underpaid%'
   and needs_attention = false;

-- A delivered or shipped order that predates the timestamps has no honest
-- value to give them, so they stay null and the UI prints a dash. Guessing
-- paid_at would be inventing a fact.

create index if not exists orders_attention_idx on public.orders (needs_attention)
  where needs_attention;
create index if not exists orders_unpaid_expiry_idx on public.orders (payment_expires_at)
  where payment_status = 'unpaid';

-- ── 6. ORDER EVENTS ──────────────────────────────────────────────────
-- Append-only. Every status change, refund, restock and sweep lands here with
-- who did it, so "you told me it shipped last Tuesday" has an answer that is
-- not somebody's memory. Nothing ever updates or deletes a row.
create table if not exists public.order_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  -- 'status' | 'payment' | 'stock' | 'attention' | 'note'
  kind        text not null,
  from_status text,
  to_status   text,
  message     text,
  -- 'system' for anything the webhook or a sweep did, 'staff' for the POS.
  actor       text not null default 'system'
);

create index if not exists order_events_order_idx
  on public.order_events (order_id, created_at desc);

comment on table public.order_events is
  'Append-only history of an order. updated_at only ever shows the last touch; this shows all of them.';

alter table public.order_events enable row level security;
-- No policies, deliberately: like orders, this is server-only. Every read and
-- write goes through a route holding the service-role key.

-- ── 7. DRAW AN ORDER'S STOCK ─────────────────────────────────────────
-- Lifted out of commit_order so it has a second caller.
--
-- When commit_order raises, its whole transaction rolls back: the payment is
-- real but no stock moved, and the order sits flagged for a human. What that
-- human usually does is restock the shelf and then want this order to draw
-- down properly — which commit_order will not do, because by then the order is
-- already marked paid and it returns early on exactly that check.
--
-- So the stock loop lives here, guarded by stock_committed rather than by
-- payment_status, and the POS can retry it directly.
--
-- Writes no history of its own; the callers do that, so there is one place
-- deciding how an event is worded.
create or replace function public.draw_order_stock(p_order_id uuid)
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
  if exists (select 1 from public.orders where id = p_order_id and stock_committed) then
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

    -- Losing the race fails loudly here rather than quietly selling the same
    -- last skein to two people. The caller is left with a captured payment and
    -- an uncommitted order, which is the pair of facts a human needs.
    get diagnostics touched = row_count;
    if touched = 0 then
      raise exception 'Not enough stock for product % (wanted %)',
        unit ->> 'product_id', unit ->> 'quantity'
        using errcode = 'check_violation';
    end if;
  end loop;

  update public.orders set stock_committed = true where id = p_order_id;
end $$;

-- ── 8. COMMIT AN ORDER (revised) ─────────────────────────────────────
-- Unchanged in what it promises — payment and stock still move together or not
-- at all, and a retried webhook still cannot draw stock twice. The loop simply
-- moved into draw_order_stock, and stock_committed is now recorded.
create or replace function public.commit_order(p_order_id uuid, p_payment_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.orders where id = p_order_id and payment_status = 'paid') then
    return;
  end if;

  perform public.draw_order_stock(p_order_id);

  update public.orders
     set payment_status    = 'paid',
         payment_reference = coalesce(nullif(p_payment_ref, ''), payment_reference),
         paid_at           = now()
   where id = p_order_id;
end $$;

-- ── 9. PUT THE STOCK BACK ────────────────────────────────────────────
-- The other half of draw_order_stock, for a cancellation or a refund. Same
-- reason it is a function rather than a loop in an API route: one transaction,
-- so a half-restocked order cannot exist.
--
-- Deliberately tolerant where drawing is strict. A product deleted since the
-- order was placed simply gets nothing back — there is no shelf left to put it
-- on, and refusing the whole restock over one missing row would strand the rest.
create or replace function public.restock_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  unit jsonb;
begin
  if not exists (
    select 1 from public.orders where id = p_order_id and stock_committed
  ) then
    raise exception 'This order has no stock drawn against it, so there is nothing to put back'
      using errcode = 'check_violation';
  end if;

  for unit in
    select jsonb_array_elements(items -> 'units') from public.orders where id = p_order_id
  loop
    update public.products
       set stock      = stock + (unit ->> 'quantity')::integer,
           -- units_sold is checked >= 0, and a hand-edit on /pos/materials may
           -- already have taken it below what this order added.
           units_sold = greatest(0, units_sold - (unit ->> 'quantity')::integer)
     where id = (unit ->> 'product_id')::uuid;
  end loop;

  update public.orders set stock_committed = false where id = p_order_id;
end $$;
