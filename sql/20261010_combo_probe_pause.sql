-- Combo Locks: pending-lock "Check market price".
-- While a check runs, the server stamps probe_paused_at / probe_pause_until on the lock.
-- combo-worker treats the lock as paused (cancels its open quotes, stops quoting) only while
-- now < probe_pause_until AND now - probe_paused_at <= 30s, so a crashed check can never
-- leave a lock dark for more than ~30s. Independent of the user's own `paused` toggle.
-- Written by the server (service role) only; no RLS change needed.

alter table public.combo_parlays
  add column if not exists probe_paused_at timestamptz,
  add column if not exists probe_pause_until timestamptz;

comment on column public.combo_parlays.probe_paused_at is
  'Check market price started (server). Worker ignores the probe pause 30s after this.';
comment on column public.combo_parlays.probe_pause_until is
  'Worker skips quoting this lock until this time (Check market price). Cleared when the check ends.';
