-- Sniper tab timeout fix: sniper_decisions (~421k rows after NBA launch) had no index on action or rfq_id,
-- so the 24h summary query walked every decision in the window and the matched/My Fills lookups seq-scanned.
-- Run outside a transaction (CONCURRENTLY).
create index concurrently if not exists sniper_decisions_action_created_idx on public.sniper_decisions (action, created_at desc);
create index concurrently if not exists sniper_decisions_rfq_action_idx on public.sniper_decisions (rfq_id, action);
