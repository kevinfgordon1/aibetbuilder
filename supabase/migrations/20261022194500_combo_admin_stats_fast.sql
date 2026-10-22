-- /api/combo-admin "All users" returned "Admin request failed": the
-- combo_admin_user_stats() RPC hit the 8s PostgREST statement_timeout because
-- its 30-day combo_submissions aggregate seq-scanned ~2.2M rows (mostly
-- declined/shadow RFQs). Only booked rows (live, ordered or filled) matter, so
-- restrict the scan to them and back it with a small partial index.
-- (Index was created CONCURRENTLY in prod on 2026-10-22.)
create index concurrently if not exists combo_submissions_admin_stats_idx
  on public.combo_submissions (created_at, user_id) include (is_live, order_id, status)
  where (is_live or order_id is not null or status = 'filled');

CREATE OR REPLACE FUNCTION public.combo_admin_user_stats()
 RETURNS TABLE(user_id uuid, locks_total bigint, locks_active bigint, live_orders bigint, orders_30d bigint, fills_count bigint, fills_contracts numeric, fills_today_contracts numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with ids as (
    select p.user_id from public.combo_parlays p where p.user_id is not null
    union select u.user_id from public.combo_live_users u
  ),
  l as (
    select p.user_id,
           count(*) filter (where p.merged_into_id is null) as locks_total,
           count(*) filter (where p.merged_into_id is null and p.active and coalesce(p.paused, false) = false and p.archived_at is null) as locks_active
    from public.combo_parlays p group by p.user_id
  ),
  s as (
    select s.user_id,
           count(*) filter (where s.is_live) as live_orders,
           count(*) filter (where s.order_id is not null or s.status = 'filled') as orders_30d
    from public.combo_submissions s
    where s.created_at >= now() - interval '30 days'
      and (s.is_live or s.order_id is not null or s.status = 'filled')
    group by s.user_id
  ),
  f as (
    select f.user_id,
           count(*) as fills_count,
           coalesce(sum(f.count), 0) as fills_contracts,
           coalesce(sum(f.count) filter (
             where f.recorded_at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')
           ), 0) as fills_today_contracts
    from public.combo_fills f
    where f.is_combo and not coalesce(f.is_taker, false)
    group by f.user_id
  )
  select ids.user_id,
         coalesce(l.locks_total, 0), coalesce(l.locks_active, 0),
         coalesce(s.live_orders, 0), coalesce(s.orders_30d, 0),
         coalesce(f.fills_count, 0), coalesce(f.fills_contracts, 0), coalesce(f.fills_today_contracts, 0)
  from ids
  left join l on l.user_id = ids.user_id
  left join s on s.user_id = ids.user_id
  left join f on f.user_id = ids.user_id;
$function$;
