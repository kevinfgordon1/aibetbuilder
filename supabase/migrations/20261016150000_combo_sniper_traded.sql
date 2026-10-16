-- Combo Sniper reads: narrow copy of traded paper RFQs, kept in sync by trigger, with a necessary-condition
-- prefilter per fair source. A row can only flag if traded_yes > P(fair): flagged needs y < traded_yes and
-- ev > 0, and ev = (1-P)C - ourCost with ourCost >= C(1-y) ⇒ y > P. 0.001 slack covers bp rounding.
create or replace function public.sniper_prob(a numeric) returns numeric
language sql immutable parallel safe as $$
  select case when a is null or (a > -100 and a < 100) then null
              when a > 0 then 100.0 / (a + 100) else -a / (-a + 100.0) end $$;

create table if not exists public.combo_sniper_traded as
  select rfq_id, rfq_created_ts, market_ticker, n_legs, legs, contracts, rfq_target_cost, fair_mid_american,
         fair_promo_best_american, promo_max_age_ms, fair_pm_inverse_american, traded_yes, traded_contracts,
         outcome, venue, legs_kalshi, poly_tick_size
  from public.noboost_paper_rfqs where false;
alter table public.combo_sniper_traded add primary key (rfq_id);
alter table public.combo_sniper_traded enable row level security;
alter table public.combo_sniper_traded
  add column pass_kalshi boolean generated always as (coalesce(traded_yes > public.sniper_prob(fair_mid_american) - 0.001, false)) stored,
  add column pass_pm boolean generated always as (coalesce(traded_yes > public.sniper_prob(fair_mid_american) - 0.001, false) or coalesce(traded_yes > public.sniper_prob(fair_pm_inverse_american) - 0.001, false)) stored,
  add column pass_promo boolean generated always as (coalesce(traded_yes > public.sniper_prob(fair_mid_american) - 0.001, false) or coalesce(traded_yes > public.sniper_prob(fair_promo_best_american) - 0.001, false)) stored;
create index if not exists combo_sniper_traded_kalshi_idx on public.combo_sniper_traded (rfq_created_ts desc) where pass_kalshi;
create index if not exists combo_sniper_traded_pm_idx on public.combo_sniper_traded (rfq_created_ts desc) where pass_pm;
create index if not exists combo_sniper_traded_promo_idx on public.combo_sniper_traded (rfq_created_ts desc) where pass_promo;

create or replace function public.combo_sniper_traded_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.outcome = 'traded' then
      insert into public.combo_sniper_traded (rfq_id, rfq_created_ts, market_ticker, n_legs, legs, contracts, rfq_target_cost,
        fair_mid_american, fair_promo_best_american, promo_max_age_ms, fair_pm_inverse_american, traded_yes, traded_contracts,
        outcome, venue, legs_kalshi, poly_tick_size)
      values (new.rfq_id, new.rfq_created_ts, new.market_ticker, new.n_legs, new.legs, new.contracts, new.rfq_target_cost,
        new.fair_mid_american, new.fair_promo_best_american, new.promo_max_age_ms, new.fair_pm_inverse_american, new.traded_yes,
        new.traded_contracts, new.outcome, new.venue, new.legs_kalshi, new.poly_tick_size)
      on conflict (rfq_id) do update set rfq_created_ts = excluded.rfq_created_ts, market_ticker = excluded.market_ticker,
        n_legs = excluded.n_legs, legs = excluded.legs, contracts = excluded.contracts, rfq_target_cost = excluded.rfq_target_cost,
        fair_mid_american = excluded.fair_mid_american, fair_promo_best_american = excluded.fair_promo_best_american,
        promo_max_age_ms = excluded.promo_max_age_ms, fair_pm_inverse_american = excluded.fair_pm_inverse_american,
        traded_yes = excluded.traded_yes, traded_contracts = excluded.traded_contracts, outcome = excluded.outcome,
        venue = excluded.venue, legs_kalshi = excluded.legs_kalshi, poly_tick_size = excluded.poly_tick_size;
    elsif tg_op = 'UPDATE' and old.outcome = 'traded' then
      delete from public.combo_sniper_traded where rfq_id = new.rfq_id;
    end if;
  exception when others then
    raise warning 'combo_sniper_traded_sync %: %', new.rfq_id, sqlerrm; -- never block the logger
  end;
  return null;
end $$;
drop trigger if exists combo_sniper_traded_sync on public.noboost_paper_rfqs;
create trigger combo_sniper_traded_sync after insert or update on public.noboost_paper_rfqs
  for each row execute function public.combo_sniper_traded_sync();
-- Backfilled 2026-10-08..now from noboost_paper_rfqs (outcome='traded') in day batches; broad index dropped:
-- drop index concurrently if exists public.noboost_paper_rfqs_outcome_created_idx;
