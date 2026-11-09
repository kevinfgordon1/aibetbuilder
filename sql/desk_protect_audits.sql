-- Compact Bet Protect decision log. Run in the Supabase SQL editor.
-- The sweep does not apply this. Service role only. No anon policies.
-- Rows are written on a trigger/action change and at most one heartbeat
-- per order each 30 seconds, not on every poll.
--
-- checked_at is when this process finished reading the HTTP body.
-- feed_at is marketData.transactTime when the payload has one. That is the
-- last book change, not the time this process fetched the snapshot. A quiet
-- book can have an old feed_at and still be current. A missing feed_at with
-- a successful read is not a failed fetch.

create table if not exists public.desk_protect_audits (
  id bigint generated always as identity primary key,
  order_id text not null,
  owner_email text not null,
  market_slug text not null default '',
  checked_at timestamptz not null,
  feed_at timestamptz,
  feed_age_ms integer,
  order_cents numeric,
  reference_cents numeric,
  mid_cents numeric,
  gap_cents numeric,
  trigger text not null,
  action text not null,
  cancel_result text,
  replacement_id text,
  created_at timestamptz not null default now()
);

create index if not exists desk_protect_audits_order_idx
  on public.desk_protect_audits (order_id, checked_at desc);

alter table public.desk_protect_audits enable row level security;
