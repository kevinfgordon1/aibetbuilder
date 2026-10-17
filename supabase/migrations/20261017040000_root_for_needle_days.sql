-- "What to root for" daily needle history (owner only): one row per user per sheet day (ET; Today rolls over at 11 AM ET).
-- result = change in expected profit from that day's games vs their kickoff (pregame) numbers, over the locks touching them.
create table if not exists public.root_for_needle_days (
  user_id uuid not null,
  day date not null,                  -- sheet day (ET)
  result numeric not null,            -- live EV − pregame EV of the day's locks ($)
  pregame_ev numeric,
  live_ev numeric,
  games int not null default 0,       -- the day's games in Today
  locks int not null default 0,       -- open locks touching them
  events text[] not null default '{}',
  snap jsonb,                         -- locks + games seen that day: positions, last live chances, kickoff numbers
  final boolean not null default false,
  final_reason text,                  -- 'all_decided' | 'rollover' | 'backfill'
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.root_for_needle_days enable row level security; -- no policies: service role only
