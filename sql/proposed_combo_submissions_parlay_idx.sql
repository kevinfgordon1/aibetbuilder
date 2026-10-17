-- PROPOSED (NOT APPLIED): per-lock attempt reads on Combo Locks.
-- History's .in(parlay_id, <100 ids>) reads take 0.4–3.7s each today (p50 4.3s in prod) because the
-- (parlay_id, created_at) index has to filter through ~1M skip/shadow rows. These partial indexes
-- hold only the rows each read returns. Both are built CONCURRENTLY (no write lock).
-- ~196k rows / ~654k rows; small extra cost on combo-worker inserts.
create index concurrently if not exists combo_submissions_parlay_quote_idx
  on public.combo_submissions (parlay_id, created_at desc)
  where status <> 'shadow' and (quote_id is not null or order_id is not null or status in ('filled','unfilled','quoted'));
create index concurrently if not exists combo_submissions_parlay_skip_idx
  on public.combo_submissions (parlay_id, created_at desc)
  where status = 'declined' and quote_id is null
    and (skip_reason is null or (skip_reason <> 'game_started' and skip_reason not like 'no_lock_overlap%'));
