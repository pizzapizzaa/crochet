-- =========================================================
-- ZippyZack.com: kits that can also be bought as the completed product
--
-- Run this in the Supabase SQL editor AFTER supabase/bundles-schema.sql.
-- Idempotent: safe to run more than once.
--
-- A make or a bundle is sold as a kit to make yourself. Some of them can now
-- also be bought finished: the shop crochets the piece and sends it. Which ones
-- is a choice made per kit in the POS, with its own price, because a finished
-- piece is priced on the work in it and not on the materials.
--
-- What it does:
--   1. Adds `makes.completed_available`: the "Available as complete product" tick
--   2. Adds `makes.completed_price`: what the finished piece sells for
--   3. Refuses a kit ticked as available with no price to charge
--
-- Until this has been run the shop carries on as before: nothing is offered
-- completed, the Gallery is empty, and saving a kit in the POS still works as
-- long as the new tick is left alone.
-- =========================================================

alter table public.makes add column if not exists completed_available boolean not null default false;
alter table public.makes add column if not exists completed_price     numeric(10, 2);

alter table public.makes drop constraint if exists makes_completed_price_check;
alter table public.makes add constraint makes_completed_price_check check (
  (completed_price is null or completed_price > 0)
  and (not completed_available or completed_price is not null)
);

-- The Gallery reads only the kits on offer completed.
create index if not exists makes_completed_idx on public.makes (is_active) where completed_available;

comment on column public.makes.completed_available is
  'True when a customer can buy the finished piece instead of the kit. Shown in the Gallery.';
comment on column public.makes.completed_price is
  'What the finished piece sells for. Required while completed_available is true.';

-- Sanity check
-- select kind, title, completed_available, completed_price
--   from public.makes
--  where completed_available
--  order by kind, display_order;
