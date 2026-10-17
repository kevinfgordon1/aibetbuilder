-- Combo Locks load speed: the "booked contracts" read
--   combo_submissions?user_id=eq.<me>&or=(status.eq.filled,is_live.eq.true)&order=created_at.desc
-- walked every one of the owner's ~1.4M submission rows (2.4s, p95 8s in prod, frequent 8s timeouts).
-- Only ~1.2k rows match, so a tiny partial index makes it ~6ms.
-- ALREADY APPLIED to prod (xuolkiadmumtbksbyjzc) on 2026-10-17 with CREATE INDEX CONCURRENTLY.
create index concurrently if not exists combo_submissions_booked_idx
  on public.combo_submissions (user_id, created_at desc)
  where (status = 'filled' or is_live = true);
