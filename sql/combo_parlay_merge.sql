-- Merge duplicate Combo Locks parlays into one hedge order.
-- Apply in the Supabase SQL editor. This file is not auto-applied.
--
-- The Railway combo-worker does not need a code change. It still reads
-- combo_parlays.parlay_stake, parlay_american, fill_american, hedge_mode,
-- max_contracts, and active. A merged order stores:
--   stake = total cash at risk (or the sum of free-bet face values when
--           every ticket is a free bet)
--   american = true odds = total profit / that stake (numeric, not rounded)
--   is_free_bet = true only when nothing is at risk
--   max_contracts = the cap the worker will actually sell
-- Original tickets stay in combo_parlay_bets for weekly book P&L.

alter table public.combo_parlays
  alter column parlay_american type numeric using parlay_american::numeric;

alter table public.combo_parlays
  add column if not exists sportsbook text,
  add column if not exists boost_pct numeric,
  add column if not exists bet_type text not null default 'cash',
  add column if not exists merged_at timestamptz,
  add column if not exists merged_into_id uuid,
  add column if not exists merge_fill_ids text[];

update public.combo_parlays
  set bet_type = 'free'
  where is_free_bet is true
    and bet_type = 'cash';

alter table public.combo_parlays
  drop constraint if exists combo_parlays_bet_type_check;

alter table public.combo_parlays
  add constraint combo_parlays_bet_type_check
  check (bet_type in ('cash', 'boost', 'free', 'hybrid'));

comment on column public.combo_parlays.parlay_american is
  'American odds the worker hedges. Merged orders store the unrounded true odds (profit / at risk) so stake * decimal equals total profit.';
comment on column public.combo_parlays.sportsbook is
  'Optional book for a single ticket. Null on a merged order; each original is on combo_parlay_bets.';
comment on column public.combo_parlays.boost_pct is
  'Optional profit-boost percent for a single ticket. Null on a merged order.';
comment on column public.combo_parlays.bet_type is
  'cash, boost, free, or hybrid when the row is a merged mix.';
comment on column public.combo_parlays.merged_into_id is
  'Set on an original parlay that was folded into another order. That row is archived and inactive so the worker does not hedge it again.';
comment on column public.combo_parlays.merge_fill_ids is
  'Counting fill ids on this order at the last merge. A new id blocks undo.';

create index if not exists combo_parlays_merged_into_idx
  on public.combo_parlays (merged_into_id)
  where merged_into_id is not null;

create table if not exists public.combo_parlay_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  parlay_id uuid not null references public.combo_parlays (id) on delete cascade,
  source_parlay_id uuid,
  role text not null default 'component',
  stake numeric not null,
  american numeric not null,
  bet_type text not null,
  sportsbook text,
  boost_pct numeric,
  created_at timestamptz not null default now(),
  merge_batch_id uuid,
  created_in_batch boolean not null default false,
  source_snapshot jsonb,
  constraint combo_parlay_bets_type_check check (bet_type in ('cash', 'boost', 'free')),
  constraint combo_parlay_bets_role_check check (role in ('component', 'survivor_snapshot', 'absorbed', 'new_bet'))
);

create index if not exists combo_parlay_bets_parlay_idx
  on public.combo_parlay_bets (parlay_id, created_at);

comment on table public.combo_parlay_bets is
  'Original sportsbook tickets linked to a Combo Locks order. Merged orders keep one row per ticket (stake, American odds, cash/boost/free, book, boost %, time).';

create table if not exists public.combo_parlay_merge_batches (
  id uuid primary key,
  user_id uuid not null,
  survivor_parlay_id uuid not null references public.combo_parlays (id) on delete cascade,
  merged_at timestamptz not null default now(),
  undone_at timestamptz,
  survivor_before jsonb not null,
  fill_ids text[] not null default '{}',
  absorb_snapshots jsonb not null default '[]'::jsonb,
  dropped_matches jsonb not null default '[]'::jsonb
);

create index if not exists combo_parlay_merge_batches_survivor_idx
  on public.combo_parlay_merge_batches (survivor_parlay_id, merged_at desc);

create table if not exists public.combo_parlay_hedge_moves (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.combo_parlay_merge_batches (id) on delete cascade,
  user_id uuid not null,
  table_name text not null,
  pk_column text not null default 'id',
  row_pk text not null,
  from_parlay_id uuid not null,
  to_parlay_id uuid not null,
  undone_at timestamptz
);

create index if not exists combo_parlay_hedge_moves_batch_idx
  on public.combo_parlay_hedge_moves (batch_id);

comment on table public.combo_parlay_hedge_moves is
  'Rows whose parlay_id was re-pointed onto the merged order (combo_fills, combo_submissions, combo_matches, quote_outcomes, and component bets). Undo writes the id back.';

alter table public.combo_parlay_bets enable row level security;
alter table public.combo_parlay_merge_batches enable row level security;
alter table public.combo_parlay_hedge_moves enable row level security;

drop policy if exists "read own combo_parlay_bets" on public.combo_parlay_bets;
create policy "read own combo_parlay_bets"
  on public.combo_parlay_bets
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "read own combo_parlay_merge_batches" on public.combo_parlay_merge_batches;
create policy "read own combo_parlay_merge_batches"
  on public.combo_parlay_merge_batches
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "read own combo_parlay_hedge_moves" on public.combo_parlay_hedge_moves;
create policy "read own combo_parlay_hedge_moves"
  on public.combo_parlay_hedge_moves
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.combo_parlay_bets to authenticated;
grant select on public.combo_parlay_merge_batches to authenticated;
grant select on public.combo_parlay_hedge_moves to authenticated;

-- Writes go through /api/combo-merge with the service role (combo_fills is
-- select-only for signed-in users, so the browser cannot re-point fills).
revoke insert, update, delete on public.combo_parlay_bets from anon, authenticated;
revoke insert, update, delete on public.combo_parlay_merge_batches from anon, authenticated;
revoke insert, update, delete on public.combo_parlay_hedge_moves from anon, authenticated;
