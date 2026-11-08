-- Verified Live Trading Desk order outcomes (Polymarket US).
-- Run this in the Supabase SQL editor. The API does not apply it.
-- Service role only (SUPABASE_SERVICE_KEY). No anon policies.
--
-- verified_state is open, partial, filled, canceled, partial_canceled,
-- expired, partial_expired, or unknown.
-- partial_canceled and partial_expired are terminal. They keep cum_qty.
-- unknown means a read failed or the order left the open list without an
-- official order payload. It is not a fill.
-- avg_yes_price is the official avgPx (YES / long price), not an average
-- of American odds. cum_qty is the exchange cumulative fill.
-- outcome is long or short. action is buy or sell. Chain spend uses each
-- row's own side: buy risk is the outcome price times cum_qty, sell risk is
-- one minus that price times cum_qty. A short outcome price is 1 - avg_yes_price.
-- A row with cum_qty > 0 and no avg_yes_price is unknown spend. Do not replace.

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
  outcome text not null default '',
  action text not null default '',
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

-- Safe if the table was created from an earlier copy of this file.
alter table public.desk_order_tracks add column if not exists outcome text not null default '';
alter table public.desk_order_tracks add column if not exists action text not null default '';
