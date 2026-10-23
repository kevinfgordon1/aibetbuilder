// Manual sportsbook hedges (arb-outs) of sniper fills — same math as combo-worker sniper/hedge.js
// and the sniper_hedged_risk SQL the caps use. We hold NO on the Kalshi parlay (R = cost + fee, n contracts);
// a hedge bets the parlay at a book (stake S, decimal D):
//   hit  = −R + Σ S·(D−1)      miss = (n − R) − Σ S
// Locked when hit ≈ miss (both ≥ worst). Net worst-case loss = max(0, −min(hit, miss)) — what caps count.
export function decimalOf(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || (a > -100 && a < 100)) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
}
export const activeHedges = (hs) => (hs || []).filter((h) => h && (h.status == null || h.status === "active") && Number(h.stake) > 0 && decimalOf(h.american) != null);

/** fill { n, risk (cost+fee), fair (P parlay hits, 0..1), baseEv } → null if no active hedge. */
export function hedgeSummary(fill, hedges) {
  const hs = activeHedges(hedges); if (!hs.length) return null;
  const n = Number(fill.n) || 0; const R = Number(fill.risk) || 0;
  const stake = hs.reduce((s, h) => s + Number(h.stake), 0);
  const payout = hs.reduce((s, h) => s + Number(h.stake) * decimalOf(h.american), 0);
  const hitDelta = payout - stake; const missDelta = -stake;            // add to the fill's hit / miss outcomes
  const hit = -R + hitDelta; const miss = n - R + missDelta;
  const worst = Math.min(hit, miss); const best = Math.max(hit, miss);
  const locked = Math.abs(hit - miss) < 0.05;
  const fair = Number(fill.fair);
  const hedgeEv = fair > 0 && fair < 1 ? fair * payout - stake : null;
  const ev = locked ? worst : fill.baseEv != null && hedgeEv != null ? Number(fill.baseEv) + hedgeEv : null;
  return { count: hs.length, stake, payout, hitDelta, missDelta, hit, miss, worst, best, locked, netRisk: Math.max(0, -worst), freed: R - Math.max(0, -worst), ev };
}
