-- Verified Live Trading Desk order outcomes (Polymarket US).
-- Run this in the Supabase SQL editor. The API does not apply it.
-- Service role only (SUPABASE_SERVICE_KEY). No anon policies.
--
-- verified_state is open, partial, filled, canceled, expired, or unknown.
-- unknown means a read failed or the order left the open list without an
-- official order payload. It is not a fill.
-- avg_yes_price is the official avgPx (YES / long price), not an average
-- of American odds. cum_qty is the exchange cumulative fill.

create table if not exists public.desk_order_tracks (
  order_id text primary key,
  owner_email text not null,
  market_slug text not null default '',
  venue text not null default 'polymarket-us',
  verified_state text not null,
  exchange_state text not null default '',
  cum_qty numeric,
  leaves_qty numeric,
  order_qty numeric,
  avg_yes_price numeric,
  cost numeric,
  fees numeric,
  opened_at timestamptz,
  last_fill_at timestamptz,
  terminal_at timestamptz,
  replaces text,
  replaced_by text,
  lineage_id text,
  unknown_reason text not null default '',
  source text not null default '',
  resolve_attempts integer not null default 0,
  total_failures integer not null default 0,
  reopen_count integer not null default 0,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists desk_order_tracks_owner_idx
  on public.desk_order_tracks (owner_email, updated_at desc);

alter table public.desk_order_tracks enable row level security;
