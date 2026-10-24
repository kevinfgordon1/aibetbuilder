-- Rollback for 20261023223000_sniper_decisions_action_idx.sql
drop index concurrently if exists public.sniper_decisions_action_created_idx;
drop index concurrently if exists public.sniper_decisions_rfq_action_idx;
