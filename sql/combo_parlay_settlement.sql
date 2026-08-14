-- Persist official Kalshi combo-market settlement on Combo Locks parlays.
-- Maker sold NO: result yes = parlay won (we lost); result no = parlay lost (we won).
-- Apply in the Supabase SQL editor if this file is not auto-applied.

ALTER TABLE public.combo_parlays
  ADD COLUMN IF NOT EXISTS combo_ticker text,
  ADD COLUMN IF NOT EXISTS kalshi_status text,
  ADD COLUMN IF NOT EXISTS kalshi_result text,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

ALTER TABLE public.combo_parlays
  DROP CONSTRAINT IF EXISTS combo_parlays_kalshi_result_check;

ALTER TABLE public.combo_parlays
  ADD CONSTRAINT combo_parlays_kalshi_result_check
  CHECK (kalshi_result IS NULL OR kalshi_result IN ('yes', 'no'));

COMMENT ON COLUMN public.combo_parlays.combo_ticker IS
  'Kalshi combo/MVE market ticker from the fill; used to poll official settlement.';
COMMENT ON COLUMN public.combo_parlays.kalshi_result IS
  'Official Kalshi combo result once determined: yes or no.';
COMMENT ON COLUMN public.combo_parlays.kalshi_status IS
  'Kalshi market status when the result was stored (determined/finalized/amended).';
COMMENT ON COLUMN public.combo_parlays.settled_at IS
  'When we first persisted the official Kalshi combo result.';
