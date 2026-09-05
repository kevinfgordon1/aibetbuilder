// Combo Locks risk / profit profile — current unhedged vs target after RFQ fills.
// Same lock math as ComboLocks decideAtFill / hedgeCap (maker fee already in fill).
// Does not invent Polymarket fill prices. Missing fill/cap → target TBD.

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function aToDec(a) {
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

function impliedProb(a) {
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
}

function r2(x) {
  return Math.round(x * 100) / 100;
}

export function moneyAbs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (Math.abs(abs - Math.round(abs)) < 1e-9) return "$" + String(Math.round(abs));
  return "$" + abs.toFixed(2);
}

export function signedMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(2);
  return (n < 0 ? "-$" : "+$") + abs;
}

export function hedgePayoffs({ stake, american, fillAmerican, contracts }) {
  const sStake = toNum(stake);
  const sAm = toNum(american);
  const sFill = toNum(fillAmerican);
  const n = toNum(contracts);
  if (!(sStake > 0) || sAm == null || sAm === 0 || !(n >= 0)) return null;
  const bookHit = sStake * aToDec(sAm) - sStake;
  const bookMiss = -sStake;
  if (!(n > 0) || sFill == null) {
    return { contracts: n || 0, hit: r2(bookHit), miss: r2(bookMiss), worst: r2(Math.min(bookHit, bookMiss)) };
  }
  const s = impliedProb(sFill);
  if (!(s > 0 && s < 1)) return null;
  const hit = bookHit + n * s - n;
  const miss = bookMiss + n * s;
  return { contracts: n, fillAmerican: sFill, hit: r2(hit), miss: r2(miss), worst: r2(Math.min(hit, miss)) };
}

export function currentUnhedged(parlay) {
  if (!parlay) return null;
  const stake = toNum(parlay.parlay_stake);
  const american = toNum(parlay.parlay_american);
  if (!(stake > 0) || american == null || american === 0) return null;
  const profit = r2(stake * aToDec(american) - stake);
  return {
    stake,
    american,
    risk: stake,
    profit,
    hit: profit,
    miss: r2(-stake),
    text: `risk ${moneyAbs(stake)} for ${moneyAbs(profit)} profit`,
  };
}

export function targetHedge(parlay) {
  if (!parlay) return null;
  const contracts = toNum(parlay.max_contracts);
  const fillAmerican = toNum(parlay.fill_american);
  if (!(contracts > 0) || fillAmerican == null) return null;
  const pay = hedgePayoffs({
    stake: parlay.parlay_stake,
    american: parlay.parlay_american,
    fillAmerican,
    contracts,
  });
  if (!pay) return null;
  return {
    ...pay,
    locks: pay.worst >= 0,
    fairAmerican: toNum(parlay.fair_american),
  };
}

export function lockProfile(parlay, filled = 0) {
  const current = currentUnhedged(parlay);
  const target = targetHedge(parlay);
  const filledN = Math.max(0, toNum(filled) || 0);
  const targetN = target ? target.contracts : null;
  const soFar = current
    ? hedgePayoffs({
      stake: parlay.parlay_stake,
      american: parlay.parlay_american,
      fillAmerican: parlay.fill_american,
      contracts: filledN,
    })
    : null;
  return {
    current,
    target,
    soFar,
    filled: filledN,
    targetContracts: targetN,
    remaining: targetN != null ? Math.max(0, targetN - filledN) : null,
    pct: targetN > 0 ? Math.min(100, Math.round((filledN / targetN) * 100)) : 0,
    targetTbd: !target,
  };
}

export function formatTargetLine(target) {
  if (!target) return "target TBD";
  const both = signedMoney(target.hit) + " / " + signedMoney(target.miss);
  const lock = target.locks ? "locked either way" : "does not fully lock";
  return `${target.contracts} contracts → ${both} (${lock})`;
}

export function formatFillProgress(profile) {
  if (!profile) return "";
  if (profile.targetTbd) return "target TBD";
  return `${profile.filled} of ${profile.targetContracts} toward target`;
}
