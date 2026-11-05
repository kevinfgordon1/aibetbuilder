-- Combo Locks: drop the 12-leg maximum (Kevin, Nov 4 2026). The only Combo
-- Locks limits are the user's contract cap and the cash in their
-- prediction-market account. Same guard as sql/20261012_combo_single_leg.sql
-- minus the upper bound: still 1+ legs, each with a ticker and side yes|no,
-- no market twice. Mirrors src/comboLegRules.js.
-- NOT auto-applied: run against the database after the site change merges.
create or replace function public.combo_parlay_legs_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare n int; d int;
begin
  if new.legs is null or jsonb_typeof(new.legs) <> 'array' then
    raise exception 'legs must be an array';
  end if;
  n := jsonb_array_length(new.legs);
  if n < 1 then
    raise exception 'a lock needs at least 1 leg (got %)', n;
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.legs) l
     where coalesce(l->>'ticker', '') = '' or coalesce(lower(l->>'side'), '') not in ('yes', 'no')
  ) then
    raise exception 'every leg needs a ticker and side yes|no';
  end if;
  select count(distinct l->>'ticker') into d from jsonb_array_elements(new.legs) l;
  if d <> n then
    raise exception 'the same market is picked twice';
  end if;
  return new;
end;
$$;
