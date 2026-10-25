-- Per-user alerts: add 'location_expired' (auto, written/resolved by combo-worker
-- when Kalshi 403s a user's quote for missing/expired location attestation) and
-- 'custom' (any one-off message: title/body come from the row, no code needed).
-- Shown app-wide on sign-in and on Combo Locks; user can dismiss (read_at).
alter table public.combo_user_alerts drop constraint if exists combo_user_alerts_kind_check;
alter table public.combo_user_alerts add constraint combo_user_alerts_kind_check
  check (kind in ('low_cash', 'no_credits', 'location_expired', 'custom'));

-- Chris Higgins: location verification expired (Oct 25). Resolves on its own
-- once combo-worker sees his quotes accepted (or set resolved_at manually).
insert into public.combo_user_alerts (user_id, kind, venue, title, body, dedupe_key)
select u.id, 'location_expired', 'kalshi', 'Verify your location on Kalshi',
  'Kalshi is rejecting your Combo Locks quotes because your location verification expired. Open the Kalshi app or website and verify your location to resume quoting.',
  'location_expired:kalshi'
from auth.users u where lower(u.email) = 'c.w.higgins1@gmail.com'
on conflict (user_id, dedupe_key) where resolved_at is null do nothing;
