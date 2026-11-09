-- Recent-quote reads on public.combo_submissions (project xuolkiadmumtbksbyjzc).
-- Not applied by this change. Kevin runs each statement in the SQL editor
-- with "Run in transaction" OFF (CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction). One statement at a time. Do not apply this file with a
-- transactional migration runner. If that runner is the only option, drop the
-- word CONCURRENTLY for that run; the build will lock writes until it finishes.
--
-- combo-worker (not in this repo) polls quotes with PostgREST:
--
--   user_id = any($ids)
--   AND venue = $venue
--   AND quote_id is not null
--   AND created_at >= $since
--   ORDER BY created_at DESC
--   LIMIT n
--
-- Two shapes in pg_stat_statements:
--
--   1) select parlay_id
--      ~35k calls, ~82ms mean, ~20M shared_blks_read
--
--   2) select id, quote_id, order_id, rfq_id, parlay_id, label, contracts,
--      user_id, status, created_at, market_ticker
--      AND status <> 'filled' AND status <> 'shadow'
--      ~37k calls, ~169ms mean, ~9.8M shared_blks_read
--
-- user_id-leading indexes cannot serve user_id = ANY plus ORDER BY created_at
-- without walking each user's history. (venue, created_at desc) walks only the
-- recent window for that venue and filters user_id from the index. quote_id
-- in INCLUDE covers shape (1) without a heap fetch. Shape (2) still fetches
-- the LIMIT rows, not every quote the user ever posted.
--
-- Combo Locks History in this repo no longer uses parlay_id = ANY(chunk).
-- Each lock is parlay_id = $id ORDER BY created_at DESC LIMIT, which the
-- existing combo_submissions_parlay_quote_idx and
-- combo_submissions_parlay_skip_idx already serve. Do not add another
-- (created_at desc, parlay_id) index for that page.

create index concurrently if not exists combo_submissions_venue_quote_created_idx
  on public.combo_submissions (venue, created_at desc)
  include (user_id, parlay_id, quote_id)
  where quote_id is not null;
