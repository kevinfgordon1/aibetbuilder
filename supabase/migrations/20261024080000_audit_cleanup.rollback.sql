begin;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('match_games_to_kalshi', 'sniper_hedged_risk')
  loop
    execute format('alter function %s reset search_path', r.sig);
  end loop;
end $$;
alter policy "authenticated users insert own activity" on public.activity_log with check (auth.uid() = user_id);
alter policy combo_single_orders_select on public.combo_single_orders using (user_id = auth.uid());
alter policy "service role full access" on public.telegram_users using (auth.role() = 'service_role'::text);
commit;
