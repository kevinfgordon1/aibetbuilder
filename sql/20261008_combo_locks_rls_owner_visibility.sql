-- Combo Locks security + visibility model (applied via Supabase apply_migration
-- as "combo_locks_rls_owner_visibility").
--
-- Model
--   * Every signed-in user sees ONLY their own combo_parlays, orders
--     (combo_submissions), fills, worker stats and unhedged RFQs.
--   * The owner (combo_live_users.is_owner, seeded = kev120909@gmail.com) sees
--     every user's rows.
--   * Writes stay "own rows only". Nobody but the owner list may disarm a kill
--     switch (combo_settings.kill_switch = false) — enforced by trigger, which
--     also binds the service role.
--   * service_role (combo-worker, aibetbuilder APIs) bypasses RLS as before.
--
-- Built to layer on next: per-tester trade-only exchange keys (service-only
-- table keyed by user_id), per-user caps (columns on combo_live_users), and
-- per-user kill switches (combo_settings already per user; the trigger below
-- already gates who may arm live trading).

-- Fail fast instead of queueing the worker behind a lock.
set local lock_timeout = '5s';

-- 1. Who may trade / who is owner --------------------------------------------
create table if not exists public.combo_live_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  is_owner   boolean not null default false,
  can_trade  boolean not null default true,
  note       text,
  added_at   timestamptz not null default now()
);
alter table public.combo_live_users enable row level security;
revoke all on public.combo_live_users from anon, authenticated;
grant select on public.combo_live_users to authenticated;

insert into public.combo_live_users (user_id, is_owner, can_trade, note)
select u.id, u.email = 'kev120909@gmail.com', true, 'Kevin (seed)'
from auth.users u
where u.email in ('kev120909@gmail.com', 'kevin.f.gordon1@gmail.com')
on conflict (user_id) do nothing;

create or replace function public.combo_is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.combo_live_users
                 where user_id = auth.uid() and is_owner);
$$;

create or replace function public.combo_can_trade(uid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.combo_live_users
                 where user_id = uid and can_trade);
$$;

create or replace function public.combo_owner_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select user_id from public.combo_live_users
  where is_owner order by added_at limit 1;
$$;

revoke all on function public.combo_is_owner() from public, anon;
revoke all on function public.combo_can_trade(uuid) from public, anon;
revoke all on function public.combo_owner_id() from public, anon;
revoke all on function public.combo_can_trade(uuid) from authenticated;
revoke all on function public.combo_owner_id() from authenticated;
-- Policies call combo_is_owner(); the other two are only used by triggers.
grant execute on function public.combo_is_owner() to authenticated, service_role;
grant execute on function public.combo_can_trade(uuid) to service_role;
grant execute on function public.combo_owner_id() to service_role;

drop policy if exists combo_live_users_read on public.combo_live_users;
create policy combo_live_users_read on public.combo_live_users
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

-- 2. Kill switch: only live users may disarm ---------------------------------
create or replace function public.combo_settings_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.kill_switch is false and not public.combo_can_trade(new.user_id) then
    raise exception 'Live trading is not enabled for this account'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists combo_settings_guard on public.combo_settings;
create trigger combo_settings_guard
  before insert or update on public.combo_settings
  for each row execute function public.combo_settings_guard();

-- 3. user_id on fills / worker stats / unhedged RFQs -------------------------
alter table public.combo_fills        add column if not exists user_id uuid;
alter table public.combo_worker_stats add column if not exists user_id uuid;
alter table public.unhedged_rfqs      add column if not exists user_id uuid;

-- Fills belong to the lock's owner; unattributed fills to the account owner.
update public.combo_fills f
   set user_id = coalesce(
         (select p.user_id from public.combo_parlays p where p.id = f.parlay_id),
         public.combo_owner_id())
 where f.user_id is null;
update public.combo_worker_stats set user_id = public.combo_owner_id() where user_id is null;
update public.unhedged_rfqs      set user_id = public.combo_owner_id() where user_id is null;

create index if not exists combo_fills_user_id_idx on public.combo_fills (user_id);

-- New rows: fill from the lock when there is one, else the account owner.
create or replace function public.combo_fill_user_id()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare lock_owner uuid;
begin
  if new.parlay_id is not null
     and (tg_op = 'INSERT' or new.parlay_id is distinct from old.parlay_id) then
    select user_id into lock_owner from public.combo_parlays where id = new.parlay_id;
    if lock_owner is not null then new.user_id := lock_owner; end if;
  end if;
  if new.user_id is null then new.user_id := public.combo_owner_id(); end if;
  return new;
end;
$$;
drop trigger if exists combo_fills_user_id on public.combo_fills;
create trigger combo_fills_user_id
  before insert or update of parlay_id, user_id on public.combo_fills
  for each row execute function public.combo_fill_user_id();

create or replace function public.combo_default_owner_user_id()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id is null then new.user_id := public.combo_owner_id(); end if;
  return new;
end;
$$;
drop trigger if exists combo_worker_stats_user_id on public.combo_worker_stats;
create trigger combo_worker_stats_user_id
  before insert on public.combo_worker_stats
  for each row execute function public.combo_default_owner_user_id();
drop trigger if exists unhedged_rfqs_user_id on public.unhedged_rfqs;
create trigger unhedged_rfqs_user_id
  before insert on public.unhedged_rfqs
  for each row execute function public.combo_default_owner_user_id();

-- 4. Policies: own rows, owner sees all ---------------------------------------
-- combo_parlays
drop policy if exists "own combo_parlays" on public.combo_parlays;
drop policy if exists combo_parlays_select on public.combo_parlays;
drop policy if exists combo_parlays_insert on public.combo_parlays;
drop policy if exists combo_parlays_update on public.combo_parlays;
drop policy if exists combo_parlays_delete on public.combo_parlays;
create policy combo_parlays_select on public.combo_parlays for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));
create policy combo_parlays_insert on public.combo_parlays for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy combo_parlays_update on public.combo_parlays for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy combo_parlays_delete on public.combo_parlays for delete to authenticated
  using (user_id = (select auth.uid()));

-- combo_settings
drop policy if exists "own combo_settings" on public.combo_settings;
drop policy if exists combo_settings_select on public.combo_settings;
drop policy if exists combo_settings_insert on public.combo_settings;
drop policy if exists combo_settings_update on public.combo_settings;
create policy combo_settings_select on public.combo_settings for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));
create policy combo_settings_insert on public.combo_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy combo_settings_update on public.combo_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- combo_submissions (orders / quotes). Users may only add their own shadow
-- (simulate) rows on their own locks; real orders are written by the worker.
drop policy if exists "own combo_submissions" on public.combo_submissions;
drop policy if exists combo_submissions_select on public.combo_submissions;
drop policy if exists combo_submissions_insert on public.combo_submissions;
create policy combo_submissions_select on public.combo_submissions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));
create policy combo_submissions_insert on public.combo_submissions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'shadow'
    and (parlay_id is null or exists (
      select 1 from public.combo_parlays p
      where p.id = parlay_id and p.user_id = (select auth.uid())))
  );

-- combo_fills / combo_worker_stats / unhedged_rfqs (read-only to users)
drop policy if exists cf_read on public.combo_fills;
drop policy if exists combo_fills_select on public.combo_fills;
create policy combo_fills_select on public.combo_fills for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

drop policy if exists cws_read on public.combo_worker_stats;
drop policy if exists combo_worker_stats_select on public.combo_worker_stats;
create policy combo_worker_stats_select on public.combo_worker_stats for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

drop policy if exists unhedged_rfqs_read on public.unhedged_rfqs;
drop policy if exists unhedged_rfqs_select on public.unhedged_rfqs;
create policy unhedged_rfqs_select on public.unhedged_rfqs for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

-- Merge tables: own rows + owner.
drop policy if exists "read own combo_parlay_bets" on public.combo_parlay_bets;
create policy "read own combo_parlay_bets" on public.combo_parlay_bets for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));
drop policy if exists "read own combo_parlay_hedge_moves" on public.combo_parlay_hedge_moves;
create policy "read own combo_parlay_hedge_moves" on public.combo_parlay_hedge_moves for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));
drop policy if exists "read own combo_parlay_merge_batches" on public.combo_parlay_merge_batches;
create policy "read own combo_parlay_merge_batches" on public.combo_parlay_merge_batches for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

-- No direct writes from the browser to worker-owned tables.
revoke insert, update, delete, truncate on public.combo_fills, public.combo_worker_stats, public.unhedged_rfqs from anon, authenticated;
revoke update, delete, truncate on public.combo_submissions from anon, authenticated;
revoke truncate on public.combo_parlays, public.combo_settings from anon, authenticated;

-- 5. combo_match_counts is a definer view (bypasses RLS on combo_matches):
--    limit it to the caller's own locks, owner sees all, no anon.
create or replace view public.combo_match_counts as
 select m.parlay_id,
    (count(*))::integer as n,
    (sum(((m.locks is true))::integer))::integer as locks_n,
    (sum(((m.sizing = 'dollar'::text))::integer))::integer as dollar_n,
    max(m.matched_at) as last_match
   from public.combo_matches m
  where public.combo_is_owner()
     or m.parlay_id in (select p.id from public.combo_parlays p where p.user_id = auth.uid())
  group by m.parlay_id;
revoke all on public.combo_match_counts from anon;
