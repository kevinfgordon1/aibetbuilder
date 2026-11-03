-- Combo Locks beta access requests.
-- Paste this into the Supabase SQL editor. Do not run it from CI.
-- Safe to re-run.
--
-- Signed-in users may insert one row for themselves (status pending) and
-- read only that row. They cannot update or delete it, so they cannot
-- approve themselves. Approval is the service-role API
-- /api/combo-access-requests (Kevin's two accounts). An approved row
-- opens the Combo Locks page. It does not add the user to combo_live_users.

begin;
set local lock_timeout = '5s';

create table if not exists public.combo_locks_access_requests (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  status     text not null default 'pending',
  constraint combo_locks_access_requests_status_check
    check (status in ('pending', 'approved', 'denied')),
  constraint combo_locks_access_requests_email_check
    check (
      email = lower(email)
      and char_length(email) between 3 and 320
      and position('@' in email) > 1
    )
);

comment on table public.combo_locks_access_requests is
  'Beta access requests for the Combo Locks tab. Users insert/read only their own row. Service role approves.';

create index if not exists combo_locks_access_requests_status_created_idx
  on public.combo_locks_access_requests (status, created_at desc);

alter table public.combo_locks_access_requests enable row level security;
alter table public.combo_locks_access_requests force row level security;

revoke all on public.combo_locks_access_requests from public, anon, authenticated;
grant select, insert on public.combo_locks_access_requests to authenticated;
revoke update, delete, truncate on public.combo_locks_access_requests from authenticated, anon, public;

drop policy if exists combo_locks_access_requests_select on public.combo_locks_access_requests;
create policy combo_locks_access_requests_select
  on public.combo_locks_access_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists combo_locks_access_requests_insert on public.combo_locks_access_requests;
create policy combo_locks_access_requests_insert
  on public.combo_locks_access_requests
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and email = lower(btrim(coalesce((select auth.jwt() ->> 'email'), '')))
  );

commit;
