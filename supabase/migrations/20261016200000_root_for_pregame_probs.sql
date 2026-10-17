-- "What to root for" Sweat meter: each game's outcome probabilities frozen at its own kickoff.
-- Overwritten by the server on every refresh until that game starts; after kickoff never overwritten.
create table if not exists public.root_for_pregame_probs (
  slate_key text not null,            -- ET date (YYYY-MM-DD) of the Tuesday that starts the NFL week
  event text not null,                -- game/event ticker, e.g. KXNFLGAME-26OCT18LACKC
  sig text not null,                  -- sorted outcome keys (a lock adding the other side gets its own row)
  probs jsonb not null,               -- { outcome: probability } from the inverse bet method
  kickoff timestamptz,
  captured_at timestamptz not null default now(),
  primary key (slate_key, event, sig)
);
alter table public.root_for_pregame_probs enable row level security; -- no policies: service role only
