-- Tag Combo Locks parlays that are free-bet conversions (not cash stake).
-- Book miss = $0; book hit = (D−1)×FB. Apply in the Supabase SQL editor
-- if this file is not auto-applied. Insert retries without the column and
-- prefixes the label "Free bet · " so the UI still uses free-bet PnL.

ALTER TABLE public.combo_parlays
  ADD COLUMN IF NOT EXISTS is_free_bet boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.combo_parlays.is_free_bet IS
  'True when parlay_stake is a free-bet face value: hit pays profit only, miss costs $0. Hedge cap 1× = (D−1)×stake, not D×stake.';
