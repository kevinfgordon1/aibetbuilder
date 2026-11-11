-- Bounded combo_submissions reads for the Polymarket workers.
-- Kevin runs this in the Supabase SQL editor. Do not wrap it in a migration
-- runner: CREATE INDEX CONCURRENTLY cannot run inside a transaction. Run the
-- index statement on its own, then the functions.
--
-- Why functions: PostgREST sends venue and status as parameters, so a generic
-- plan will not use combo_submissions_poly_unfilled_idx /
-- combo_submissions_poly_ordered_unfilled_idx (their predicates are the
-- literals venue = 'polymarket' and status not in ('filled','shadow')).
-- Putting those literals in the function body lets the planner stop at LIMIT
-- on the partial index (~300 or ~500 rows) instead of filtering a 21-day
-- venue scan (~123ms, ~193 heap blocks, ~51k calls on the unfilled read).
--
-- The parlay-id read (loadRecentLocks, limit 2000) is an index-only scan of
-- combo_submissions_venue_quote_created_idx that then filters user_id
-- (~60ms, ~416 blocks, ~49k calls). The new index leads with user_id so each
-- worker user is a 2000-row index-only scan. The function is correct before
-- the index exists; the index is what makes it cheap.

create index concurrently if not exists combo_submissions_user_poly_quote_created_idx
  on public.combo_submissions (user_id, created_at desc)
  include (parlay_id)
  where venue = 'polymarket' and quote_id is not null;

create or replace function public.combo_poly_unfilled_quotes(p_user uuid, p_since timestamptz, p_limit integer)
returns table (
  id uuid,
  quote_id text,
  order_id text,
  rfq_id text,
  parlay_id uuid,
  label text,
  contracts numeric,
  user_id uuid,
  status text,
  created_at timestamptz,
  market_ticker text
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.quote_id, s.order_id, s.rfq_id, s.parlay_id, s.label, s.contracts,
         s.user_id, s.status, s.created_at, s.market_ticker
  from public.combo_submissions s
  where s.user_id = p_user
    and s.venue = 'polymarket'
    and s.quote_id is not null
    and s.status <> 'filled'
    and s.status <> 'shadow'
    and s.created_at >= p_since
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 300), 0), 300);
$$;

create or replace function public.combo_poly_ordered_unfilled_quotes(p_user uuid, p_since timestamptz, p_limit integer)
returns table (
  id uuid,
  quote_id text,
  order_id text,
  rfq_id text,
  parlay_id uuid,
  label text,
  contracts numeric,
  user_id uuid,
  status text,
  created_at timestamptz,
  market_ticker text
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.quote_id, s.order_id, s.rfq_id, s.parlay_id, s.label, s.contracts,
         s.user_id, s.status, s.created_at, s.market_ticker
  from public.combo_submissions s
  where s.user_id = p_user
    and s.venue = 'polymarket'
    and s.quote_id is not null
    and s.order_id is not null
    and s.status <> 'filled'
    and s.status <> 'shadow'
    and s.created_at >= p_since
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 500), 0), 500);
$$;

create or replace function public.combo_poly_quoted_parlay_ids(p_user uuid, p_since timestamptz, p_limit integer)
returns table (
  parlay_id uuid,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.parlay_id, s.created_at
  from public.combo_submissions s
  where s.user_id = p_user
    and s.venue = 'polymarket'
    and s.quote_id is not null
    and s.created_at >= p_since
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 2000), 0), 2000);
$$;

revoke all on function public.combo_poly_unfilled_quotes(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.combo_poly_ordered_unfilled_quotes(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.combo_poly_quoted_parlay_ids(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.combo_poly_unfilled_quotes(uuid, timestamptz, integer) to service_role;
grant execute on function public.combo_poly_ordered_unfilled_quotes(uuid, timestamptz, integer) to service_role;
grant execute on function public.combo_poly_quoted_parlay_ids(uuid, timestamptz, integer) to service_role;
