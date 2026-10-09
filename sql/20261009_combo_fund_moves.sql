-- Combo Locks tester auto-funding log. combo-worker (service role) writes one
-- row per automatic move of a tester's OWN Kalshi money from Exchange 0
-- (Default) to Exchange 1 (Combos), using that tester's own key. Nothing else
-- is ever moved: the checks below only allow 0 -> 1 on Kalshi. Read-only to
-- users: own rows, Kevin (combo_is_owner) sees all. No key material here.
--
-- status: sending   = row written, transfer about to be sent (written FIRST,
--                     so a move is never sent without a log row)
--         accepted  = Kalshi accepted it, not confirmed yet
--         confirmed = Kalshi's transfer record (or balances) show it landed
--         failed    = Kalshi refused it, or it never appeared
create table if not exists public.combo_fund_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue text not null default 'kalshi' check (venue = 'kalshi'),
  from_shard smallint not null default 0 check (from_shard = 0),
  to_shard smallint not null default 1 check (to_shard = 1),
  amount_usd numeric(12, 2) not null check (amount_usd > 0),
  status text not null check (status in ('sending', 'accepted', 'confirmed', 'failed')),
  transfer_id text,
  combo_before_usd numeric(14, 2),
  default_before_usd numeric(14, 2),
  cap_usd numeric(12, 2),
  reason text check (reason is null or length(reason) <= 80),
  error text check (error is null or length(error) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists combo_fund_moves_user_created_idx
  on public.combo_fund_moves (user_id, created_at desc);

alter table public.combo_fund_moves enable row level security;

drop policy if exists combo_fund_moves_select on public.combo_fund_moves;
create policy combo_fund_moves_select on public.combo_fund_moves
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

revoke all on public.combo_fund_moves from anon;
revoke insert, update, delete, truncate on public.combo_fund_moves from authenticated;
grant select on public.combo_fund_moves to authenticated;

comment on table public.combo_fund_moves is
  'Combo Locks tester auto-funding: Kalshi Default (0) -> Combos (1) moves on the tester''s own account, written by combo-worker (service role). RLS: own rows + owner.';
