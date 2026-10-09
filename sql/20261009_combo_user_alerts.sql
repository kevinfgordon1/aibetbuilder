-- Per-user Combo Locks alerts (low combos cash). combo-worker (service role)
-- writes a row when one of the user's quotes/orders is rejected by Kalshi or
-- Polymarket for insufficient balance, and resolves it once that user's cash
-- covers the need again. Users read (and dismiss) their own rows; Kevin
-- (combo_is_owner) reads every user's rows for "All users". Safe to re-run.
--
-- Throttle: at most ONE unresolved row per (user_id, dedupe_key). The worker
-- uses dedupe_key = 'low_cash:<venue>:<parlay_id>' and also caps new rows to
-- one per user per hour in memory. Routine successful moves never write here.
create table if not exists public.combo_user_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'low_cash' check (kind in ('low_cash')),
  venue text not null default 'kalshi' check (venue in ('kalshi', 'polymarket')),
  parlay_id uuid,
  lock_label text check (lock_label is null or length(lock_label) <= 200),
  title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  body text not null default '' check (length(body) <= 600),
  need_usd numeric(12, 2),
  available_usd numeric(14, 2),
  shortfall_usd numeric(12, 2),
  skipped_count integer not null default 1,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz
);

create unique index if not exists combo_user_alerts_open_dedupe_idx
  on public.combo_user_alerts (user_id, dedupe_key)
  where resolved_at is null;

create index if not exists combo_user_alerts_user_created_idx
  on public.combo_user_alerts (user_id, created_at desc);

alter table public.combo_user_alerts enable row level security;

drop policy if exists combo_user_alerts_select on public.combo_user_alerts;
create policy combo_user_alerts_select on public.combo_user_alerts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

-- Users may only stamp read_at (dismiss) on their own rows.
drop policy if exists combo_user_alerts_dismiss on public.combo_user_alerts;
create policy combo_user_alerts_dismiss on public.combo_user_alerts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.combo_user_alerts from anon;
revoke all on public.combo_user_alerts from authenticated;
grant select on public.combo_user_alerts to authenticated;
grant update (read_at) on public.combo_user_alerts to authenticated;
grant all on public.combo_user_alerts to service_role;

comment on table public.combo_user_alerts is
  'Combo Locks per-user low-cash alerts (quote rejected / skipped for insufficient balance). Written + resolved by combo-worker; RLS: own rows, owner sees all.';
