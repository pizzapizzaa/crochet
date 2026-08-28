-- =========================================================
-- ZippyZack.com — indexes the importers rely on
--
-- Run this in the Supabase SQL editor AFTER supabase/makes-schema.sql.
-- Idempotent: safe to run more than once.
--
-- Nothing here changes a column or a policy. Both importers ask the same
-- question before they write anything — "have I already got this?" — and
-- these are the indexes that make the answer cheap:
--
--   * the bulk pin importer looks every pasted pin up by its id and its URL,
--     so a board pasted twice comes back marked instead of duplicated
--   * the product importer looks up the source link before creating a row,
--     which is what makes pressing Import twice harmless
--
-- Without them everything still works, on a sequential scan per lookup. With
-- a few hundred rows that is invisible; it is the kind of invisible that stops
-- being invisible exactly when the catalogue gets interesting.
-- =========================================================

-- ── Pins already imported ────────────────────────────────────────────
create index if not exists makes_pin_id_idx on public.makes (pinterest_pin_id)
  where pinterest_pin_id is not null;

create index if not exists makes_pin_url_idx on public.makes (pinterest_url);

-- ── Products already imported from a given shop page ─────────────────
create index if not exists products_supplier_url_idx on public.products (supplier_url)
  where supplier_url is not null;

comment on column public.products.supplier_url is
  'Where this product came from. Set by the importers and used to recognise a second import of the same listing; also what the material cost page links back to.';
