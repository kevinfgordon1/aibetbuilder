-- Per-leg placement fair prices for Combo Locks (additive; nothing else changes).
-- Each value is the inverse bet fair the "What to root for" sheet already uses (src/rootForPrices.js legFair:
-- 1 − fee-included $500 VWAP to buy the opposite side, best venue of Kalshi / Polymarket US / Novig).
--   at_lock:  saved once, right after the lock is added (or the first time the capture job sees it).
--   pregame:  refreshed every 5 minutes while the lock's first game is within 20 minutes of kickoff;
--             never written after kickoff, so the last value is the price at (or just before) kickoff.
-- fairs jsonb: { "<TICKER>:<side>": { "p": 0.4123, "a": 143, "v": "kalshi" } } for each leg and both
-- moneyline sides of every game the lock touches. Read by /api/root-for to freeze each lock's pregame baseline.
-- Separate table (not a combo_parlays column) so combo-worker's select('*') on combo_parlays is untouched.
create table if not exists public.combo_lock_leg_fairs (
  parlay_id uuid primary key references public.combo_parlays(id) on delete cascade,
  user_id uuid not null,
  at_lock jsonb,
  at_lock_at timestamptz,
  at_lock_src text,                   -- 'add-lock' | 'first-seen'
  pregame jsonb,
  pregame_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists combo_lock_leg_fairs_user_idx on public.combo_lock_leg_fairs (user_id);
alter table public.combo_lock_leg_fairs enable row level security; -- no policies: service role only (API routes)
