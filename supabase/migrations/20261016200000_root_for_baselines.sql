-- "What to root for" Sweat meter: pregame expected-profit baseline per slate week (owner-only, server writes).
create table if not exists public.root_for_baselines (
  slate_key text primary key,          -- ET date (YYYY-MM-DD) of the Tuesday that starts the NFL week
  ev numeric not null,                 -- expected profit across open Combo Locks, last value before first kickoff
  first_kickoff timestamptz not null,
  captured_at timestamptz not null default now()
);
alter table public.root_for_baselines enable row level security; -- no policies: service role only
