-- Combo Locks "Available to trade": balances written by combo-worker (service
-- role) every ~60s from each account's own exchange keys. Read-only to users:
-- own rows, Kevin (combo_is_owner) sees all. No key material is stored here.
create table if not exists public.combo_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue text not null check (venue in ('kalshi', 'polymarket_us')),
  -- Kalshi exchange_index: 1 = combo bucket (KXMVE), 0 = main / single-game.
  -- Polymarket US: always 0.
  shard smallint not null default 0 check (shard in (0, 1)),
  available_usd numeric(14, 2),
  portfolio_usd numeric(14, 2),
  buying_power_usd numeric(14, 2),
  ok boolean not null default false,
  error text check (error is null or length(error) <= 40),
  fetched_at timestamptz,
  checked_at timestamptz not null default now(),
  primary key (user_id, venue, shard)
);

alter table public.combo_balances enable row level security;

drop policy if exists combo_balances_select on public.combo_balances;
create policy combo_balances_select on public.combo_balances
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

revoke all on public.combo_balances from anon;
revoke insert, update, delete, truncate on public.combo_balances from authenticated;
grant select on public.combo_balances to authenticated;

comment on table public.combo_balances is
  'Combo Locks available-to-trade balances per user/venue/shard, written by combo-worker (service role). RLS: own rows + owner.';
