-- Combo Locks: edit fill odds + cancel open quotes.
-- fill_edited_at: when the user last changed fill_american (card "edited" note).
-- cancel_open_at: bump to ask the worker to cancel all open quotes on this lock.
-- cancel_requested_at on combo_submissions: bump to cancel that one open quote.
-- Matched fills (real order_id / filled) are never cancelled by these signals.

alter table public.combo_parlays
  add column if not exists fill_edited_at timestamptz,
  add column if not exists cancel_open_at timestamptz;

comment on column public.combo_parlays.fill_edited_at is
  'Last time the user (or owner) changed fill_american. UI shows an edited note.';
comment on column public.combo_parlays.cancel_open_at is
  'Worker cancels open Kalshi/Polymarket quotes for this lock when this advances.';

alter table public.combo_submissions
  add column if not exists cancel_requested_at timestamptz;

comment on column public.combo_submissions.cancel_requested_at is
  'Worker cancels this open quote (is_live) when set. Filled/matched rows ignored.';

-- Owner may update others' locks (edit fill / cancel signals). Insert/delete stay own-only.
drop policy if exists combo_parlays_update on public.combo_parlays;
create policy combo_parlays_update on public.combo_parlays for update to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()))
  with check (user_id = (select auth.uid()) or (select public.combo_is_owner()));

-- Users (and owner) may stamp cancel_requested_at on open submissions they can see.
-- Real quote rows are still written by the worker (service role).
drop policy if exists combo_submissions_update on public.combo_submissions;
create policy combo_submissions_update on public.combo_submissions for update to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()))
  with check (user_id = (select auth.uid()) or (select public.combo_is_owner()));
