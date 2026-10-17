-- Combo Locks per-lock attempt reads (open-lock cards + History details).
-- ALREADY APPLIED to prod (xuolkiadmumtbksbyjzc) on 2026-10-17 with CREATE INDEX CONCURRENTLY,
-- one at a time; both indisvalid = true (quote ~7.8 MB, skip ~25 MB).
create index concurrently if not exists combo_submissions_parlay_quote_idx
  on public.combo_submissions (parlay_id, created_at desc)
  where status <> 'shadow' and (quote_id is not null or order_id is not null or status in ('filled','unfilled','quoted'));
create index concurrently if not exists combo_submissions_parlay_skip_idx
  on public.combo_submissions (parlay_id, created_at desc)
  where status = 'declined' and quote_id is null
    and (skip_reason is null or (skip_reason <> 'game_started' and skip_reason not like 'no_lock_overlap%'));
