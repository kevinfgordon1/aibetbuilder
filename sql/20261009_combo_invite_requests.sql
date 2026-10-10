-- Combo Locks invite requests (invite-only waitlist). Shown only to signed-in
-- users who don't already have Combo Locks. Users insert and read ONLY their
-- own row; Kevin (combo_is_owner) reads all and may change status only.
-- Approving does NOT grant access (access stays the hardcoded allowlist).
-- No emails or notifications are sent from here. Safe to re-run.
create table if not exists public.combo_invite_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null check (length(btrim(email)) > 0 and length(email) <= 320),
  books text check (books is null or length(books) <= 500),
  notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists combo_invite_requests_created_idx
  on public.combo_invite_requests (created_at desc);

alter table public.combo_invite_requests enable row level security;

drop policy if exists combo_invite_requests_select on public.combo_invite_requests;
create policy combo_invite_requests_select on public.combo_invite_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

-- Users insert only their own row, always pending.
drop policy if exists combo_invite_requests_insert on public.combo_invite_requests;
create policy combo_invite_requests_insert on public.combo_invite_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and decided_at is null);

-- Only the owner changes status (column grant limits it to status/decided_at).
drop policy if exists combo_invite_requests_owner_update on public.combo_invite_requests;
create policy combo_invite_requests_owner_update on public.combo_invite_requests
  for update to authenticated
  using ((select public.combo_is_owner()))
  with check ((select public.combo_is_owner()));

revoke all on public.combo_invite_requests from anon;
revoke all on public.combo_invite_requests from authenticated;
grant select on public.combo_invite_requests to authenticated;
grant insert (user_id, email, books, notes) on public.combo_invite_requests to authenticated;
grant update (status, decided_at) on public.combo_invite_requests to authenticated;
grant all on public.combo_invite_requests to service_role;

comment on table public.combo_invite_requests is
  'Combo Locks invite requests. RLS: users insert/read own row; owner reads all and sets status. Approval does not grant access.';
