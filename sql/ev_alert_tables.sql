-- Owner-only +EV parlay Telegram alerts (@evparlaysbot).
-- Service-role API access only. Do not use telegram_users (KayGo).

CREATE TABLE IF NOT EXISTS public.ev_alert_chats (
  telegram_chat_id bigint PRIMARY KEY,
  display_name text,
  username text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ev_parlay_alerts (
  fingerprint text PRIMARY KEY,
  book_key text NOT NULL,
  ev_pct numeric NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  legs jsonb
);

ALTER TABLE public.ev_alert_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ev_parlay_alerts ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: the public Data API cannot read these.
-- Vercel functions use SUPABASE_SERVICE_KEY, which bypasses RLS.
