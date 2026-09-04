-- Optional index for the Unhedged RFQ filled blotter.
-- Today / 24h / 7d query: status = 'filled' AND filled_at in the window,
-- ORDER BY filled_at DESC. Without this, date-window filters compete with
-- millions of `seen` rows on public.unhedged_rfqs.
--
-- Apply in the Supabase SQL editor if missing. CONCURRENTLY is safer on
-- a live table; drop CONCURRENTLY if you are applying inside a migration
-- transaction.
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS unhedged_rfqs_status_filled_at_idx
--   ON public.unhedged_rfqs (status, filled_at DESC);

CREATE INDEX IF NOT EXISTS unhedged_rfqs_status_filled_at_idx
  ON public.unhedged_rfqs (status, filled_at DESC);
