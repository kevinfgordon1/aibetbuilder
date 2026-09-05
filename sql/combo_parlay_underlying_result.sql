-- Persist underlying Combo Lock / parlay result when no official combo ticker exists.
-- Source is kalshi_legs (official single-game markets) or espn (public scoreboard).
-- Do not overwrite kalshi_result — that column is official Kalshi combo/MVE only.
-- Apply in the Supabase SQL editor if this file is not auto-applied.

ALTER TABLE public.combo_parlays
  ADD COLUMN IF NOT EXISTS underlying_result text,
  ADD COLUMN IF NOT EXISTS underlying_source text,
  ADD COLUMN IF NOT EXISTS underlying_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS leg_results jsonb;

ALTER TABLE public.combo_parlays
  DROP CONSTRAINT IF EXISTS combo_parlays_underlying_result_check;

ALTER TABLE public.combo_parlays
  ADD CONSTRAINT combo_parlays_underlying_result_check
  CHECK (underlying_result IS NULL OR underlying_result IN ('won', 'lost', 'push'));

ALTER TABLE public.combo_parlays
  DROP CONSTRAINT IF EXISTS combo_parlays_underlying_source_check;

ALTER TABLE public.combo_parlays
  ADD CONSTRAINT combo_parlays_underlying_source_check
  CHECK (underlying_source IS NULL OR underlying_source IN ('kalshi_legs', 'espn'));

COMMENT ON COLUMN public.combo_parlays.underlying_result IS
  'Underlying parlay result from Kalshi single-game markets or ESPN scores: won, lost, or push.';
COMMENT ON COLUMN public.combo_parlays.underlying_source IS
  'kalshi_legs | espn — which official source stamped underlying_result.';
COMMENT ON COLUMN public.combo_parlays.underlying_settled_at IS
  'When we first persisted the underlying parlay result.';
COMMENT ON COLUMN public.combo_parlays.leg_results IS
  'Per-leg won/lost/push/pending rows that produced underlying_result.';
