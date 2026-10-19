-- Combo Locks: combo_match_counts called combo_is_owner() once PER combo_matches row
-- (30k rows, a SECURITY DEFINER lookup each): ~450 ms in Postgres, ~950 ms p50 at the API
-- for every Combo Locks poll. Wrapping it (and auth.uid()) in a scalar sub-select makes
-- Postgres evaluate it once (InitPlan): ~20 ms. Same rows, same columns, same grants.
create or replace view public.combo_match_counts as
select parlay_id,
       count(*)::integer as n,
       sum((locks is true)::integer)::integer as locks_n,
       sum((sizing = 'dollar'::text)::integer)::integer as dollar_n,
       max(matched_at) as last_match
  from public.combo_matches m
 where (select public.combo_is_owner())
    or parlay_id in (select p.id from public.combo_parlays p where p.user_id = (select auth.uid()))
 group by parlay_id;
