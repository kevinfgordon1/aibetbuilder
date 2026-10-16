-- Combo Sniper (/api/raw-parlay-edges) reads traded rows newest-first. Applied to prod CONCURRENTLY on 2026-10-16.
create index if not exists noboost_paper_rfqs_traded_created_idx on public.noboost_paper_rfqs (rfq_created_ts desc) where outcome = 'traded';
create index if not exists noboost_paper_rfqs_traded_created_cost_idx on public.noboost_paper_rfqs (rfq_created_ts desc, rfq_target_cost) where outcome = 'traded';
