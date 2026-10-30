-- love23 loss-rebate tracker (api/love23-rebate.js). Kevin runs this once.
-- Weekly (Tue-Tue) settlement; see lib/love23-ledger.js for how kinds are used.
-- Service-key access only: RLS on, no policies (anon/authenticated cannot read).

create table if not exists public.love23_daily (
  date date primary key,
  win_loss numeric not null default 0,      -- love23 settled net for the day (from /v1/players/settled)
  orders int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.love23_ledger (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('hedge', 'adjust', 'carry', 'settlement')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  game text,
  market text,
  venue text check (venue is null or venue in ('kalshi', 'polymarket', 'novig', 'prophetx')),
  side text,
  american int,
  stake numeric,
  result text check (result is null or result in ('open', 'won', 'lost', 'push', 'void')),
  pnl numeric not null default 0,
  note text,
  love23_ticket text
);

create index if not exists love23_ledger_kind_created on public.love23_ledger (kind, created_at desc);

alter table public.love23_daily enable row level security;
alter table public.love23_ledger enable row level security;
