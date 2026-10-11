create extension if not exists pgcrypto;

create table if not exists public.pattern_designs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 160),
  document jsonb not null check (jsonb_typeof(document) = 'object' and document->>'version' = '1'),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pattern_designs_updated_at_idx on public.pattern_designs (updated_at desc);
alter table public.pattern_designs enable row level security;
revoke all on public.pattern_designs from anon, authenticated;
grant all on public.pattern_designs to service_role;