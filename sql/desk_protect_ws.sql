-- Realtime Bet Protect. Apply in the Supabase SQL editor. This file is not
-- applied by the app. Service role only. No anon policies.
--
-- desk_protect_ws_control turns the poly-worker websocket on without a
-- deploy. id 1 is the only row. enabled defaults to false.
--
-- desk_protect_audits.latency_ms is milliseconds from the websocket event
-- (or disconnect detection) to the Polymarket cancel acknowledgement.
-- Older audit rows leave it null. Until this column exists, the writers
-- retry the insert without it.

create table if not exists public.desk_protect_ws_control (
  id integer primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.desk_protect_ws_control (id, enabled, updated_by)
values (1, false, 'default')
on conflict (id) do nothing;

alter table public.desk_protect_ws_control enable row level security;

alter table public.desk_protect_audits
  add column if not exists latency_ms integer;
