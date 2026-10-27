-- Native app push tokens (FCM; iOS via FCM->APNs). Kevin runs this in the SQL editor.
create table if not exists public.push_tokens (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios','android')),
  alerts jsonb not null default '{"lock_filled":true,"outbid":true,"ev_boost":true}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index if not exists push_tokens_user_idx on public.push_tokens(user_id) where disabled_at is null;
alter table public.push_tokens enable row level security;
drop policy if exists push_tokens_own_select on public.push_tokens;
create policy push_tokens_own_select on public.push_tokens for select using (auth.uid() = user_id);
drop policy if exists push_tokens_own_insert on public.push_tokens;
create policy push_tokens_own_insert on public.push_tokens for insert with check (auth.uid() = user_id);
drop policy if exists push_tokens_own_update on public.push_tokens;
create policy push_tokens_own_update on public.push_tokens for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists push_tokens_own_delete on public.push_tokens;
create policy push_tokens_own_delete on public.push_tokens for delete using (auth.uid() = user_id);
