-- Adverse Protect registry for the private Live Trading Desk.
-- Apply in the Supabase SQL editor before arming Protect.
-- Service-role API access only (SUPABASE_SERVICE_KEY). No anon policies.

create table if not exists public.desk_protect_rests (
  order_id text primary key,
  owner_email text not null,
  market_slug text not null,
  outcome text not null,
  action text not null,
  yes_price text not null,
  outcome_micro bigint not null,
  contracts numeric not null,
  x_cents numeric not null,
  y_cents numeric not null,
  lineage_id text not null,
  protect_count integer not null default 0,
  status text not null default 'armed',
  hold_from text,
  sweep_token text,
  replaced_by text,
  replaces text,
  pending_yes_price text,
  pending_contracts numeric,
  pending_intent text,
  cooldown_until timestamptz,
  title text,
  outcome_name text,
  tick numeric,
  min_qty numeric,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists desk_protect_rests_status_idx
  on public.desk_protect_rests (status, updated_at);

alter table public.desk_protect_rests enable row level security;
