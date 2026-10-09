-- Combo Locks prepaid credits (USDC via Coinbase Business Checkouts).
--
-- combo_credit_ledger  : append-only ledger. One row per money movement:
--                        deposit (+), fee (-), allowance (+, free monthly grant),
--                        adjustment (+/-, Kevin by hand), refund (-).
--                        Balance is ALWAYS derived from this table (no stored
--                        balance column that can drift).
-- combo_credit_checkouts: one row per Coinbase checkout we create, so the
--                        webhook maps a checkout id back to OUR user/amount and
--                        never trusts metadata in the webhook body.
-- combo_credit_balances: security_invoker view = sum(ledger) per user.
--
-- Idempotency: unique (source, source_ref). A Coinbase checkout id can credit
-- a user exactly once no matter how many times the webhook is retried.
--
-- RLS: users read only their own rows; Kevin (combo_is_owner()) reads all.
-- No browser writes at all: deposits come from /api/coinbase-webhook with the
-- service role; fees/allowance are NOT charged yet (off in config).

create table if not exists public.combo_credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('deposit', 'fee', 'allowance', 'adjustment', 'refund')),
  amount_usd numeric(14, 2) not null check (amount_usd <> 0),
  source text not null check (length(source) between 1 and 40),
  source_ref text check (source_ref is null or length(source_ref) <= 120),
  note text check (note is null or length(note) <= 280),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint combo_credit_ledger_sign check (
    (kind in ('deposit', 'allowance') and amount_usd > 0)
    or (kind in ('fee', 'refund') and amount_usd < 0)
    or kind = 'adjustment'
  ),
  constraint combo_credit_ledger_source_ref_key unique (source, source_ref)
);

create index if not exists combo_credit_ledger_user_created_idx
  on public.combo_credit_ledger (user_id, created_at desc);

create table if not exists public.combo_credit_checkouts (
  id text primary key check (length(id) between 1 and 64),
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_usd numeric(14, 2) not null check (amount_usd > 0),
  currency text not null default 'USDC',
  network text not null default 'base',
  status text not null default 'ACTIVE',
  url text,
  tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists combo_credit_checkouts_user_created_idx
  on public.combo_credit_checkouts (user_id, created_at desc);

create or replace view public.combo_credit_balances
with (security_invoker = true) as
select l.user_id,
       coalesce(sum(l.amount_usd), 0)::numeric(14, 2) as balance_usd,
       coalesce(sum(l.amount_usd) filter (where l.kind = 'deposit'), 0)::numeric(14, 2) as deposits_usd,
       coalesce(-sum(l.amount_usd) filter (where l.kind = 'fee'), 0)::numeric(14, 2) as fees_usd,
       max(l.created_at) as last_entry_at
  from public.combo_credit_ledger l
 group by l.user_id;

alter table public.combo_credit_ledger enable row level security;
alter table public.combo_credit_checkouts enable row level security;

drop policy if exists combo_credit_ledger_select on public.combo_credit_ledger;
create policy combo_credit_ledger_select on public.combo_credit_ledger
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

drop policy if exists combo_credit_checkouts_select on public.combo_credit_checkouts;
create policy combo_credit_checkouts_select on public.combo_credit_checkouts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.combo_is_owner()));

revoke all on public.combo_credit_ledger, public.combo_credit_checkouts, public.combo_credit_balances from anon;
revoke insert, update, delete, truncate on public.combo_credit_ledger, public.combo_credit_checkouts from authenticated;
grant select on public.combo_credit_ledger, public.combo_credit_checkouts, public.combo_credit_balances to authenticated;

comment on table public.combo_credit_ledger is
  'Combo Locks prepaid credits ledger (1 credit = $1). Balance = sum(amount_usd). Written only by the service role (/api/coinbase-webhook) or Kevin via SQL. RLS: own rows + owner.';
comment on table public.combo_credit_checkouts is
  'Coinbase Business checkouts created for Combo Locks credits; maps checkout id -> user/amount for the webhook. RLS: own rows + owner.';
comment on view public.combo_credit_balances is
  'Derived Combo Locks credit balance per user (security_invoker, so ledger RLS applies).';
