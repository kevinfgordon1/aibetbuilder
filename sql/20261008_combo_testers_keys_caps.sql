-- Per-tester Combo Locks trading (applied via Supabase apply_migration as
-- "combo_testers_keys_caps"). Builds on combo_locks_rls_owner_visibility.
--
-- * combo_live_users: owner pause + per-user caps (USD of hedge cost).
--   New rows default to $50 per lock / $250 per day. Kevin's rows: NULL = no
--   per-user cap (his locks keep their own max_contracts, unchanged).
-- * combo_exchange_keys: one row per (user, venue). The secret lives in
--   Supabase Vault; the table holds only the vault id + a masked hint. No
--   browser role can read or write the table; only service-role RPCs below.
-- * combo_can_trade() now also requires "not paused", so a paused user can't
--   disarm their kill switch (combo_settings_guard).
set local lock_timeout = '5s';

alter table public.combo_live_users
  add column if not exists paused boolean not null default false,
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by uuid,
  add column if not exists max_per_lock_usd numeric(12,2) default 50 check (max_per_lock_usd is null or max_per_lock_usd >= 0),
  add column if not exists max_per_day_usd  numeric(12,2) default 250 check (max_per_day_usd is null or max_per_day_usd >= 0);

-- Kevin keeps today's behaviour: no per-user dollar caps.
update public.combo_live_users u
   set max_per_lock_usd = null, max_per_day_usd = null
  from auth.users a
 where a.id = u.user_id and a.email in ('kev120909@gmail.com', 'kevin.f.gordon1@gmail.com');

create or replace function public.combo_can_trade(uid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.combo_live_users
                 where user_id = uid and can_trade and not paused);
$$;

create table if not exists public.combo_exchange_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  venue         text not null check (venue in ('kalshi', 'polymarket_us')),
  key_id        text not null,
  key_hint      text not null,
  secret_id     uuid not null,
  scopes        text[],
  scope_status  text not null default 'unverified' check (scope_status in ('ok', 'unverified')),
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, venue)
);
alter table public.combo_exchange_keys enable row level security;
revoke all on public.combo_exchange_keys from anon, authenticated;

-- Store / rotate a key. The secret goes straight into Vault.
create or replace function public.combo_exchange_key_put(
  p_user uuid, p_venue text, p_key_id text, p_secret text, p_hint text,
  p_scopes text[], p_scope_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare existing public.combo_exchange_keys%rowtype; sid uuid;
begin
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'secret missing' using errcode = '22023';
  end if;
  select * into existing from public.combo_exchange_keys where user_id = p_user and venue = p_venue;
  if found then
    perform vault.update_secret(existing.secret_id, p_secret);
    update public.combo_exchange_keys
       set key_id = p_key_id, key_hint = p_hint, scopes = p_scopes,
           scope_status = coalesce(p_scope_status, 'unverified'),
           verified_at = now(), updated_at = now()
     where id = existing.id;
  else
    sid := vault.create_secret(p_secret,
      'combo_key_' || p_venue || '_' || p_user::text || '_' || replace(gen_random_uuid()::text, '-', ''),
      'Combo Locks exchange key');
    insert into public.combo_exchange_keys (user_id, venue, key_id, key_hint, secret_id, scopes, scope_status, verified_at)
    values (p_user, p_venue, p_key_id, p_hint, sid, p_scopes, coalesce(p_scope_status, 'unverified'), now());
  end if;
end;
$$;

create or replace function public.combo_exchange_key_delete(p_user uuid, p_venue text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare sid uuid;
begin
  delete from public.combo_exchange_keys where user_id = p_user and venue = p_venue returning secret_id into sid;
  if sid is null then return false; end if;
  delete from vault.secrets where id = sid;
  return true;
end;
$$;

-- Worker-only: decrypted keys for approved, unpaused, non-owner users.
create or replace function public.combo_exchange_keys_for_worker()
returns table (user_id uuid, venue text, key_id text, secret text, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select k.user_id, k.venue, k.key_id, s.decrypted_secret, k.updated_at
    from public.combo_exchange_keys k
    join public.combo_live_users u on u.user_id = k.user_id
    join vault.decrypted_secrets s on s.id = k.secret_id
   where u.can_trade and not u.paused and not u.is_owner;
$$;

revoke all on function public.combo_exchange_key_put(uuid, text, text, text, text, text[], text) from public, anon, authenticated;
revoke all on function public.combo_exchange_key_delete(uuid, text) from public, anon, authenticated;
revoke all on function public.combo_exchange_keys_for_worker() from public, anon, authenticated;
grant execute on function public.combo_exchange_key_put(uuid, text, text, text, text, text[], text) to service_role;
grant execute on function public.combo_exchange_key_delete(uuid, text) to service_role;
grant execute on function public.combo_exchange_keys_for_worker() to service_role;
