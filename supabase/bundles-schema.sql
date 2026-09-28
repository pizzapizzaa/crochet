-- =========================================================
-- ZippyZack.com — Bundles beside makes, and items a customer can skip
--
-- Run this in the Supabase SQL editor AFTER supabase/makes-schema.sql.
-- Idempotent: safe to run more than once.
--
-- The shop sells kits, never a single roll of yarn. There are two kinds:
--
--   make    a kit inspired by a Pinterest pin or an existing design, credited
--           to its author — the rows this table has always held
--   bundle  a kit put together by the shop around a skill level, "Bundle for
--           beginners" — no pin, no author, nothing to credit
--
-- Both are one row in `makes` with a list of `make_items`, priced and sold the
-- same way. What changes is the list: every item in it is now part of the kit,
-- and the ones marked `can_opt_out` — a hook, scissors, a needle, the tools
-- somebody already owns — can be left out by the customer, which takes their
-- share off the price.
--
-- What it does:
--   1. Adds `makes.kind` ('make' | 'bundle')
--   2. Lets a bundle have no Pinterest link or author, while a make still must
--   3. Renames `make_items.is_optional` to `can_opt_out`
--   4. Rebuilds the `make_bundle_totals` view for the new meaning
--
-- ⚠ Step 3 changes what existing optional items mean. They used to be extras
-- listed beside the kit and not sold with it; now they are in the kit, and the
-- customer can take them out. A make with optional items will cost more by the
-- price of those items until they are edited. Check them in /pos/makes.
-- =========================================================

-- ── 1. KIND ──────────────────────────────────────────────────────────
alter table public.makes add column if not exists kind text not null default 'make';

alter table public.makes drop constraint if exists makes_kind_check;
alter table public.makes add constraint makes_kind_check check (kind in ('make', 'bundle'));

create index if not exists makes_kind_idx on public.makes (kind, is_active);

comment on column public.makes.kind is
  'make: inspired by a pin or design and credited to its author. bundle: the shop''s own kit, e.g. for a skill level.';

-- ── 2. ATTRIBUTION ONLY WHERE THERE IS SOMEONE TO CREDIT ─────────────
-- Attribution stays a data constraint for makes: a make still cannot be saved
-- without the link and the name of the person whose design it is.
alter table public.makes alter column pinterest_url drop not null;
alter table public.makes alter column author_name   drop not null;

alter table public.makes drop constraint if exists makes_attribution_check;
alter table public.makes add constraint makes_attribution_check check (
  kind = 'bundle'
  or (pinterest_url is not null and btrim(pinterest_url) <> ''
      and author_name is not null and btrim(author_name) <> '')
);

-- ── 3. ITEMS A CUSTOMER CAN SKIP ─────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'make_items' and column_name = 'is_optional'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'make_items' and column_name = 'can_opt_out'
  ) then
    alter table public.make_items rename column is_optional to can_opt_out;
  end if;
end
$$;

alter table public.make_items add column if not exists can_opt_out boolean not null default false;

comment on column public.make_items.can_opt_out is
  'Part of the kit, but the customer may leave it out — a tool they already own. Everything else is always included.';

-- ── 4. BUNDLE TOTALS VIEW ────────────────────────────────────────────
-- The whole kit at today's prices, and how much of it the customer could
-- choose to leave out.
drop view if exists public.make_bundle_totals;
create view public.make_bundle_totals as
select
  m.id as make_id,
  m.kind,
  coalesce(sum(mi.quantity * p.price), 0)::numeric(10, 2) as items_subtotal,
  coalesce(sum(mi.quantity * p.price) filter (where mi.can_opt_out), 0)::numeric(10, 2) as opt_out_subtotal,
  coalesce(sum(mi.quantity * p.cost_price), 0)::numeric(10, 2) as items_cost,
  count(mi.id) as item_count,
  count(mi.id) filter (where mi.can_opt_out) as opt_out_count
from public.makes m
left join public.make_items mi on mi.make_id = m.id
left join public.products   p  on p.id = mi.product_id and p.is_active
group by m.id, m.kind;

alter view public.make_bundle_totals set (security_invoker = on);

-- ── 5. Sanity check ──────────────────────────────────────────────────
-- select m.kind, m.title, t.item_count, t.opt_out_count, t.items_subtotal
--   from public.makes m join public.make_bundle_totals t on t.make_id = m.id
--  order by m.kind, m.display_order;
