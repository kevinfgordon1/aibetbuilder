-- Combo Locks fees, per user (Kevin approved 2026-10-09; lawyer OK while there
-- are 15 or fewer paying clients). Additive and safe to re-run.
--
-- * combo_live_users.fees_enabled / monthly_allowance_usd: per-user settings.
--   Default OFF, so Kevin, gmoneyvikes and Higgins stay fee-free. Only the
--   service role / SQL editor can change them (no browser writes).
-- * Cap: at most 15 users with fees_enabled (trigger refuses the 16th).
-- * Fee = 1% of amount at risk on each filled lock = 0.01 x contracts x lay
--   price, lay price = 1 - yes_price (fallback no_price), rounded to the cent.
--   Charged by an AFTER INSERT trigger on combo_fills, once per (user, fill_id).
--   Drawn first from the monthly allowance (resets on the 1st, America/New_York,
--   no rollover), then from purchased credits (combo_credit_ledger kind 'fee').
--   Fills are never reversed; a fill bigger than what's left can take the
--   purchased balance below $0, and the worker then stops new quotes.
-- * Only real Kalshi trades and Polymarket activity trades are charged. Order
--   stubs from live-runner (raw.source = 'live-runner' / fill_id = order_id)
--   and poly-recon twins are skipped so a twin never double-charges.
-- * combo_my_fee_status(): what the signed-in user sees on the credits card.
--   combo_fee_status_for_worker(uids): service role, used to gate quoting.

set local lock_timeout = '5s';

alter table public.combo_live_users
  add column if not exists fees_enabled boolean not null default false,
  add column if not exists monthly_allowance_usd numeric(12,2) not null default 0
    check (monthly_allowance_usd >= 0);

create or replace function public.combo_fees_cap_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  if new.fees_enabled and (tg_op = 'INSERT' or not coalesce(old.fees_enabled, false)) then
    perform pg_advisory_xact_lock(hashtext('combo_fees_cap'));
    select count(*) into n from public.combo_live_users
     where fees_enabled and user_id <> new.user_id;
    if n >= 15 then
      raise exception 'Combo Locks fees: 15 paying clients already (limit 15). Turn fees off for someone first.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists combo_fees_cap_guard on public.combo_live_users;
create trigger combo_fees_cap_guard before insert or update of fees_enabled on public.combo_live_users
  for each row execute function public.combo_fees_cap_guard();

-- One row per charged fill: how the fee was split.
create table if not exists public.combo_fee_charges (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  fill_id text not null,
  parlay_id uuid,
  contracts numeric(14, 2) not null,
  lay_price numeric(8, 4) not null,
  fee_usd numeric(12, 2) not null check (fee_usd > 0),
  from_allowance_usd numeric(12, 2) not null default 0 check (from_allowance_usd >= 0),
  from_credits_usd numeric(12, 2) not null default 0 check (from_credits_usd >= 0),
  month_et date not null,
  created_at timestamptz not null default now(),
  constraint combo_fee_charges_split check (from_allowance_usd + from_credits_usd = fee_usd),
  constraint combo_fee_charges_fill_key unique (user_id, fill_id)
);
create index if not exists combo_fee_charges_user_month_idx on public.combo_fee_charges (user_id, month_et);
alter table public.combo_fee_charges enable row level security;
drop policy if exists combo_fee_charges_select on public.combo_fee_charges;
create policy combo_fee_charges_select on public.combo_fee_charges
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));
revoke all on public.combo_fee_charges from anon;
revoke insert, update, delete, truncate on public.combo_fee_charges from authenticated;
grant select on public.combo_fee_charges to authenticated;

create or replace function public.combo_month_et(ts timestamptz default now())
returns date language sql stable set search_path = ''
as $$ select date_trunc('month', ts at time zone 'America/New_York')::date $$;

create or replace function public.combo_charge_fill_fee()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  u record; lay numeric; fee numeric; used numeric; left_ numeric;
  from_a numeric; from_c numeric; m date; src text; fid text; ins_id bigint;
begin
  if new.user_id is null or not coalesce(new.is_combo, false) or coalesce(new.is_taker, false)
     or coalesce(new.count, 0) <= 0 or new.fill_id is null then
    return new;
  end if;
  select fees_enabled, monthly_allowance_usd into u from public.combo_live_users where user_id = new.user_id;
  if not found or not u.fees_enabled then return new; end if;

  src := coalesce(new.raw->>'source', '');
  fid := new.fill_id;
  if fid like 'poly-%' or src like 'poly-%' then
    if not (fid like 'poly-act:%' or src = 'poly-act') then return new; end if;  -- skip recon/position twins
  elsif src = 'live-runner' or fid = new.order_id then
    return new;                                                                  -- Kalshi order stub
  end if;

  lay := coalesce(1 - new.yes_price, new.no_price);
  if lay is null or lay <= 0 or lay >= 1 then return new; end if;
  fee := round(0.01 * new.count * lay, 2);
  if fee <= 0 then return new; end if;

  perform pg_advisory_xact_lock(hashtext('combo_fee:' || new.user_id::text));
  m := public.combo_month_et(now());
  select coalesce(sum(from_allowance_usd), 0) into used from public.combo_fee_charges
   where user_id = new.user_id and month_et = m;
  left_ := greatest(coalesce(u.monthly_allowance_usd, 0) - used, 0);
  from_a := least(fee, left_);
  from_c := fee - from_a;

  insert into public.combo_fee_charges (user_id, fill_id, parlay_id, contracts, lay_price, fee_usd, from_allowance_usd, from_credits_usd, month_et)
  values (new.user_id, fid, new.parlay_id, new.count, lay, fee, from_a, from_c, m)
  on conflict on constraint combo_fee_charges_fill_key do nothing
  returning id into ins_id;
  if ins_id is null then return new; end if;

  if from_c > 0 then
    insert into public.combo_credit_ledger (user_id, kind, amount_usd, source, source_ref, note, meta)
    values (new.user_id, 'fee', -from_c, 'combo_fill_fee', left(new.user_id::text || ':' || fid, 120),
            'Combo Locks 1% fee', jsonb_build_object('fill_id', fid, 'parlay_id', new.parlay_id,
              'contracts', new.count, 'lay_price', lay, 'fee_usd', fee, 'from_allowance_usd', from_a))
    on conflict on constraint combo_credit_ledger_source_ref_key do nothing;
  end if;
  return new;
exception when others then
  -- Never block a fill from being recorded; the reconcile below can re-charge.
  raise warning 'combo_charge_fill_fee failed for fill %: %', new.fill_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists combo_charge_fill_fee on public.combo_fills;
create trigger combo_charge_fill_fee after insert on public.combo_fills
  for each row execute function public.combo_charge_fill_fee();

-- Allowance + credits snapshot for a set of users.
create or replace function public.combo_fee_status_for_worker(uids uuid[])
returns table (user_id uuid, fees_enabled boolean, monthly_allowance_usd numeric,
               allowance_used_usd numeric, allowance_left_usd numeric,
               credits_usd numeric, can_quote boolean, month_et date)
language sql stable security definer set search_path = ''
as $$
  with m as (select public.combo_month_et(now()) as m)
  select l.user_id, l.fees_enabled, l.monthly_allowance_usd,
         coalesce(c.used, 0),
         greatest(l.monthly_allowance_usd - coalesce(c.used, 0), 0),
         coalesce(b.bal, 0),
         (not l.fees_enabled) or greatest(l.monthly_allowance_usd - coalesce(c.used, 0), 0) > 0 or coalesce(b.bal, 0) > 0,
         (select m from m)
    from public.combo_live_users l
    left join lateral (select sum(f.from_allowance_usd) used from public.combo_fee_charges f
                        where f.user_id = l.user_id and f.month_et = (select m from m)) c on true
    left join lateral (select sum(g.amount_usd) bal from public.combo_credit_ledger g
                        where g.user_id = l.user_id) b on true
   where l.user_id = any(uids);
$$;

create or replace function public.combo_my_fee_status()
returns table (user_id uuid, fees_enabled boolean, monthly_allowance_usd numeric,
               allowance_used_usd numeric, allowance_left_usd numeric,
               credits_usd numeric, can_quote boolean, month_et date)
language sql stable security definer set search_path = ''
as $$ select * from public.combo_fee_status_for_worker(array[(select auth.uid())]) $$;

revoke all on function public.combo_fee_status_for_worker(uuid[]) from public, anon, authenticated;
grant execute on function public.combo_fee_status_for_worker(uuid[]) to service_role;
revoke all on function public.combo_my_fee_status() from public, anon;
grant execute on function public.combo_my_fee_status() to authenticated;
revoke all on function public.combo_charge_fill_fee() from public, anon, authenticated;
revoke all on function public.combo_fees_cap_guard() from public, anon, authenticated;

-- "Add credits to keep quoting" alerts reuse combo_user_alerts.
alter table public.combo_user_alerts drop constraint if exists combo_user_alerts_kind_check;
alter table public.combo_user_alerts add constraint combo_user_alerts_kind_check
  check (kind in ('low_cash', 'no_credits'));

-- Kenny Guido (kmguido97@gmail.com): fees on, $100 free each month.
update public.combo_live_users
   set fees_enabled = true, monthly_allowance_usd = 100
 where user_id = '42b5ee16-68d5-4b3b-a931-40aa17cd1a47';

-- Add someone later (refused once 15 users have fees on):
--   update public.combo_live_users set fees_enabled = true, monthly_allowance_usd = 100
--    where user_id = (select id from auth.users where email = 'someone@example.com');
