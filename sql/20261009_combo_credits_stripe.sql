-- Combo Locks credits: Stripe card checkouts alongside USDC (Coinbase).
-- Additive only. Stripe Checkout Session ids (cs_live_...) can exceed 64 chars,
-- so the id check is widened. provider tells the two flows apart; disputes are
-- flagged on the checkout row (credits are NOT clawed back automatically).
alter table public.combo_credit_checkouts drop constraint if exists combo_credit_checkouts_id_check;
alter table public.combo_credit_checkouts add constraint combo_credit_checkouts_id_check check (length(id) between 1 and 255);
alter table public.combo_credit_checkouts add column if not exists provider text not null default 'coinbase'
  check (provider in ('coinbase', 'stripe'));
alter table public.combo_credit_checkouts add column if not exists payment_intent text
  check (payment_intent is null or length(payment_intent) <= 255);
alter table public.combo_credit_checkouts add column if not exists disputed_at timestamptz;
alter table public.combo_credit_checkouts add column if not exists dispute_id text
  check (dispute_id is null or length(dispute_id) <= 255);
create index if not exists combo_credit_checkouts_payment_intent_idx
  on public.combo_credit_checkouts (payment_intent) where payment_intent is not null;
