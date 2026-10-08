-- Prices the odds-ingest outlier guard (lib/odds-outlier-guard.js) kept out of
-- odds_cache / event_odds_cache, or would have in ODDS_OUTLIER_GUARD=dry mode.
-- One row per event/book/line; /api/fetch-odds upserts on flag_key every run
-- and refreshes last_seen_at. Service role writes; only the owner reads
-- (JWT email kev120909@gmail.com, same gate as app_alerts). Safe to re-run.

CREATE TABLE IF NOT EXISTS public.odds_outlier_flags (
  flag_key text PRIMARY KEY,
  sport text NOT NULL,
  event_id text NOT NULL,
  commence_time timestamptz,
  home_team text,
  away_team text,
  book text NOT NULL,
  market text NOT NULL,
  outcome_name text NOT NULL,
  outcome_description text,
  point numeric,
  price integer NOT NULL,
  consensus_price integer,
  consensus_books integer NOT NULL DEFAULT 0,
  gap_logit numeric,
  edge_pct numeric,
  reason text NOT NULL,
  detail text,
  mode text NOT NULL DEFAULT 'on',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS odds_outlier_flags_last_seen_idx
  ON public.odds_outlier_flags (last_seen_at DESC);

COMMENT ON TABLE public.odds_outlier_flags IS
  'Owner-only log of odds the ingest outlier guard dropped (or would drop in dry mode). Service role writes.';

ALTER TABLE public.odds_outlier_flags ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.odds_outlier_flags FROM PUBLIC;
REVOKE ALL ON TABLE public.odds_outlier_flags FROM anon;
REVOKE ALL ON TABLE public.odds_outlier_flags FROM authenticated;
GRANT SELECT ON TABLE public.odds_outlier_flags TO authenticated;
GRANT ALL ON TABLE public.odds_outlier_flags TO service_role;

DROP POLICY IF EXISTS odds_outlier_flags_select_owner ON public.odds_outlier_flags;
CREATE POLICY odds_outlier_flags_select_owner
  ON public.odds_outlier_flags
  FOR SELECT
  TO authenticated
  USING (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'kev120909@gmail.com');
