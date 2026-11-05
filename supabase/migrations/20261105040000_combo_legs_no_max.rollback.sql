-- Rollback: restore the 1..12 leg guard from sql/20261012_combo_single_leg.sql.
create or replace function public.combo_parlay_legs_guard()
returns trigger language plpgsql set search_path = ''
as $$
declare n int; d int;
begin
  if new.legs is null or jsonb_typeof(new.legs) <> 'array' then
    raise exception 'legs must be an array';
  end if;
  n := jsonb_array_length(new.legs);
  if n < 1 or n > 12 then
    raise exception 'a lock needs 1 to 12 legs (got %)', n;
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
