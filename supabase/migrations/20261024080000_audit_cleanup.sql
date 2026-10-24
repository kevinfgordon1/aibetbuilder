-- Audit (Oct 24, 2026) Medium/Low cleanup. Paste into the Supabase SQL editor.
-- Rollback: 20261024080000_audit_cleanup.rollback.sql
begin;

-- 1. Pin search_path on the two functions the advisor flags (function_search_path_mutable).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('match_games_to_kalshi', 'sniper_hedged_risk')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.sig);
  end loop;
end $$;

-- 2. auth_rls_initplan: evaluate auth.uid()/auth.role() once per query, not per row. Same rules.
alter policy "authenticated users insert own activity" on public.activity_log
  with check ((select auth.uid()) = user_id);
alter policy combo_single_orders_select on public.combo_single_orders
  using (user_id = (select auth.uid()));
alter policy "service role full access" on public.telegram_users
  using ((select auth.role()) = 'service_role'::text);

commit;
