-- Per-user Combo Lock Telegram alerts (testers, Oct 2026). Service role only.
create table if not exists public.combo_tg_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  link_token text not null unique,
  chat_id bigint,
  enabled boolean not null default true,
  linked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists combo_tg_links_chat_idx on public.combo_tg_links(chat_id);
alter table public.combo_tg_links enable row level security;
revoke all on public.combo_tg_links from anon, authenticated;
