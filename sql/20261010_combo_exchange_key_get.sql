-- Single-user decrypted exchange key for Combo Locks Probe (testers use their
-- own Kalshi key). Service role only — never expose to anon/authenticated.
create or replace function public.combo_exchange_key_get(p_user uuid, p_venue text)
returns table (key_id text, secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.key_id, s.decrypted_secret
    from public.combo_exchange_keys k
    join vault.decrypted_secrets s on s.id = k.secret_id
   where k.user_id = p_user
     and k.venue = p_venue
   limit 1;
$$;

revoke all on function public.combo_exchange_key_get(uuid, text) from public, anon, authenticated;
grant execute on function public.combo_exchange_key_get(uuid, text) to service_role;
