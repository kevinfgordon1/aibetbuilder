-- Audit (Oct 24, 2026) high-priority RLS fixes. Paste into the Supabase SQL editor.
-- Rollback: 20261024070000_audit_high_rls.rollback.sql
begin;

-- 1. combo_match_counts: stop running as the view owner (advisor 0010_security_definer_view).
--    With security_invoker the caller's RLS on combo_matches applies, so give combo_matches a
--    SELECT policy with the same rule the view already used: owner sees all, everyone else only
--    matches on their own locks. (combo_matches had RLS on and no policies = invisible.)
drop policy if exists combo_matches_select_own on public.combo_matches;
create policy combo_matches_select_own on public.combo_matches
  for select to authenticated
  using (
    (select public.combo_is_owner())
    or parlay_id in (select p.id from public.combo_parlays p where p.user_id = (select auth.uid()))
  );

create or replace view public.combo_match_counts
  with (security_invoker = true) as
select parlay_id,
       count(*)::integer as n,
       sum((locks is true)::integer)::integer as locks_n,
       sum((sizing = 'dollar'::text)::integer)::integer as dollar_n,
       max(matched_at) as last_match
  from public.combo_matches m
 where (select public.combo_is_owner())
    or parlay_id in (select p.id from public.combo_parlays p where p.user_id = (select auth.uid()))
 group by parlay_id;
revoke all on public.combo_match_counts from anon;
grant select on public.combo_match_counts to authenticated;

-- 2. SECURITY DEFINER trigger functions callable over RPC (advisor 0028/0029).
--    Triggers don't need EXECUTE for the inserting role, so revoking only blocks direct
--    /rest/v1/rpc calls. Only functions that return trigger / event_trigger are touched.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
       and p.proname in ('notify_real_fill','rls_auto_enable','combo_settings_guard',
                         'combo_sniper_traded_sync','enforce_parlay_share_limit',
                         'combo_fill_user_id','combo_default_owner_user_id')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    raise notice 'revoked execute on %', r.sig;
  end loop;
end $$;

commit;
