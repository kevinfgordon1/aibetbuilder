-- Owner "All users" view: per-user Combo Locks counts in one call.
-- Service role only (api/combo-admin.js, owner-gated); never callable from the browser.
create or replace function public.combo_admin_user_stats()
returns table (
  user_id uuid,
  locks_total bigint,
  locks_active bigint,
  live_orders bigint,
  orders_30d bigint,
  fills_count bigint,
  fills_contracts numeric,
  fills_today_contracts numeric
)
language sql stable security definer set search_path = ''
as $$
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
$$;

revoke all on function public.combo_admin_user_stats() from public, anon, authenticated;
grant execute on function public.combo_admin_user_stats() to service_role;
