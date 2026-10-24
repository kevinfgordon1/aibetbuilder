-- Rollback for 20261024070000_audit_high_rls.sql
begin;
alter view public.combo_match_counts set (security_invoker = false);
drop policy if exists combo_matches_select_own on public.combo_matches;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('notify_real_fill','rls_auto_enable','combo_settings_guard',
                         'combo_sniper_traded_sync','enforce_parlay_share_limit',
                         'combo_fill_user_id','combo_default_owner_user_id')
  loop
    execute format('grant execute on function %s to public, anon, authenticated', r.sig);
  end loop;
end $$;
commit;
