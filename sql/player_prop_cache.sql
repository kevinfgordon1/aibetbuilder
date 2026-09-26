-- NFL player touchdown props for Promo (The Odds API + exchange fair prices).
-- Service-role cron writes. The Promo client reads with the anon key, same
-- as event_odds_cache. No anon writes.

CREATE TABLE IF NOT EXISTS public.player_prop_cache (
  event_id text PRIMARY KEY,
  sport text NOT NULL,
  commence_time timestamptz,
  home_team text,
  away_team text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  markets text[] NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_prop_cache_sport_commence_idx
  ON public.player_prop_cache (sport, commence_time);

ALTER TABLE public.player_prop_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read player_prop_cache" ON public.player_prop_cache;
CREATE POLICY "public read player_prop_cache"
  ON public.player_prop_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.player_prop_cache TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.player_prop_cache FROM anon, authenticated;
