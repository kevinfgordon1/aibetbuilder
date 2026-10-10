-- Per-lock Quote history reads (comboLockSubmissions.js) filter by parlay_id.
-- With ~700k rows and only (user_id, created_at) indexed they seq-scanned and
-- hit the 8s authenticated statement_timeout, blanking "Not filled" on cards.
-- Applied on prod 2026-10-09 with CONCURRENTLY.
create index concurrently if not exists combo_submissions_parlay_created_idx
  on public.combo_submissions (parlay_id, created_at desc);
