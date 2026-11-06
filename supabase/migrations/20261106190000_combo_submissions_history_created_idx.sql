-- Combo Locks History reads on public.combo_submissions average about 2s.
-- pg_stat_statements (project xuolkiadmumtbksbyjzc), repeated PostgREST calls:
--
--   1) Quote history, mean ~1.9s, ~34k calls. src/comboLockSubmissions.js
--      applyQuoteFilters, archived .in(parlay_id) chunks:
--        status <> 'shadow'
--        AND (quote_id IS NOT NULL OR order_id IS NOT NULL
--             OR status IN ('filled','unfilled','quoted'))
--        AND parlay_id = ANY ($ids)
--        ORDER BY created_at DESC
--        LIMIT 400
--
--   2) Skip history, mean ~2.0s, ~34k calls. applySkipFilters, same chunks:
--        status = 'declined'
--        AND quote_id IS NULL
--        AND (skip_reason IS NULL
--             OR (skip_reason <> 'game_started'
--                 AND skip_reason NOT LIKE 'no_lock_overlap%'))
--        AND parlay_id = ANY ($ids)
--        ORDER BY created_at DESC
--        LIMIT 80
--
-- combo_submissions_user_idx is already (user_id, created_at desc). These
-- statements do not filter user_id (the per-lock partial indexes are faster
-- than walking that index). EXPLAIN of the same quote read with user_id added
-- uses combo_submissions_user_idx at ~6x the cost. Do not add another
-- (user_id, created_at desc) index for this.
--
-- combo_submissions_parlay_quote_idx / _skip_idx are (parlay_id, created_at desc)
-- with the predicates below. Postgres uses them, then sorts every match in the
-- 100-id chunk (~16k–21k heap rows) before LIMIT. That sort is the ~2s.
-- Leading with created_at lets ORDER BY created_at DESC LIMIT stop after the
-- newest rows, and parlay_id in the index filters the chunk without a heap
-- fetch until a row matches.
--
-- NOT applied to production by this change. Apply each statement on its own,
-- outside a transaction (CREATE INDEX CONCURRENTLY cannot run inside one).
-- Supabase SQL editor: turn off "Run in transaction" if it is on, and run one
-- statement at a time. Or psql with autocommit, one statement at a time.
-- Do not apply this file with a transactional migration runner. If that runner
-- is the only option, drop the word CONCURRENTLY for that run so the statement
-- is legal inside the transaction; it will lock writes on combo_submissions
-- until the build finishes.
--
-- After both indexes are valid (pg_index.indisvalid), reload Combo Locks History
-- and confirm EXPLAIN uses these indexes for the two statements above.

create index concurrently if not exists combo_submissions_quote_history_created_idx
  on public.combo_submissions (created_at desc, parlay_id)
  where status <> 'shadow'
    and (quote_id is not null or order_id is not null or status in ('filled', 'unfilled', 'quoted'));

create index concurrently if not exists combo_submissions_skip_history_created_idx
  on public.combo_submissions (created_at desc, parlay_id)
  where status = 'declined'
    and quote_id is null
    and (skip_reason is null or (skip_reason <> 'game_started' and skip_reason not like 'no_lock_overlap%'));
