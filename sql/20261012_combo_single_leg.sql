-- Single-leg Combo Locks.
-- 1) Server-side leg rules on combo_parlays (mirrors src/comboLegRules.js):
--    1..12 legs, each with a ticker and side yes|no, no market twice.
-- 2) combo_single_orders: one row per resting/finished venue order that
--    combo-worker (single-leg-runner.js) placed for a 1-leg lock. Written by
--    the worker (service role). Owners read their own rows for the lock card.
-- Fills from these orders go into combo_fills (is_combo=true, raw.source=
-- 'single-leg'), so the existing fee trigger (combo_charge_fill_fee: $100
-- monthly allowance, then 1% of contracts × hedge price) applies unchanged.

create or replace function public.combo_parlay_legs_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare n int; d int;
begin
  if new.legs is null or jsonb_typeof(new.legs) <> 'array' then
    raise exception 'legs must be an array';
  end if;
  n := jsonb_array_length(new.legs);
  if n < 1 or n > 12 then
    raise exception 'a lock needs 1 to 12 legs (got %)', n;
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.legs) l
     where coalesce(l->>'ticker', '') = '' or coalesce(lower(l->>'side'), '') not in ('yes', 'no')
  ) then
    raise exception 'every leg needs a ticker and side yes|no';
  end if;
  select count(distinct l->>'ticker') into d from jsonb_array_elements(new.legs) l;
  if d <> n then
    raise exception 'the same market is picked twice';
  end if;
  return new;
end;
$$;

drop trigger if exists combo_parlay_legs_guard on public.combo_parlays;
create trigger combo_parlay_legs_guard
  before insert or update of legs on public.combo_parlays
  for each row execute function public.combo_parlay_legs_guard();

create table if not exists public.combo_single_orders (
  id bigserial primary key,
  parlay_id uuid not null references public.combo_parlays(id) on delete cascade,
  user_id uuid not null,
  venue text not null check (venue in ('kalshi', 'polymarket')),
  order_id text not null,
  market text not null,
  hedge text,
  price numeric,
  size numeric not null default 0,
  filled numeric not null default 0,
  open numeric not null default 0,
  status text not null default 'resting' check (status in ('resting', 'filled', 'canceled')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint combo_single_orders_venue_order unique (venue, order_id)
);
create index if not exists combo_single_orders_parlay_idx on public.combo_single_orders (parlay_id);
create index if not exists combo_single_orders_resting_idx on public.combo_single_orders (status) where status = 'resting';
alter table public.combo_single_orders enable row level security;
drop policy if exists combo_single_orders_select on public.combo_single_orders;
create policy combo_single_orders_select on public.combo_single_orders
  for select to authenticated using (user_id = auth.uid());
revoke all on public.combo_single_orders from anon;
revoke insert, update, delete, truncate on public.combo_single_orders from authenticated;
grant select on public.combo_single_orders to authenticated;
