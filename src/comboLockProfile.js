// Combo Locks risk / profit profile — current standing vs target after RFQ fills.
// Same lock math as ComboLocks decideAtFill / hedgeCap (maker fee already in fill).
// Does not invent Polymarket fill prices. Missing fill/cap → target TBD.
// currentUnhedged is book-only. lockProfile.current becomes book+fills standing when filled > 0.
//
// Cash parlay: hit = (D−1)×stake, miss = −stake. 1× cap = D×stake (equalizes both sides).
// Free bet:    hit = (D−1)×FB,     miss = $0.    1× cap = (D−1)×FB.
// Combo RFQ still hedges the joint hit vs miss (not per-leg 2-way). Multi-leg IS lockable.

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

export function formatAmericanOdds(american) {
  const n = toNum(american);
  if (n == null || n === 0) return null;
  return n > 0 ? "+" + n : "" + n;
}

export function lockKind(source) {
  if (source === "freebet" || source === true) return "freebet";
  if (!source || typeof source !== "object") return "cash";
  if (source.kind === "freebet" || source.stake_kind === "freebet") return "freebet";
  if (source.is_free_bet === true || source.isFreeBet === true) return "freebet";
  if (/^free bet\b/i.test(String(source.label || ""))) return "freebet";
  return "cash";
}

export function isFreeBetLock(source) {
  return lockKind(source) === "freebet";
}

// Book-only payoffs. Free bet: profit only on a hit, $0 on a miss (stake not returned).
// equalizeN is the 1× contract count that makes hit = miss after buying that many NO.
export function bookPnL({ stake, american, kind } = {}) {
  const sStake = toNum(stake);
  const sAm = toNum(american);
  if (!(sStake > 0) || sAm == null || sAm === 0) return null;
  const dec = aToDec(sAm);
  if (lockKind(kind) === "freebet") {
    const bookHit = sStake * (dec - 1);
    return { kind: "freebet", stake: sStake, american: sAm, dec, bookHit, bookMiss: 0, equalizeN: bookHit };
  }
  const winReturn = sStake * dec;
  return {
    kind: "cash",
    stake: sStake,
    american: sAm,
    dec,
    bookHit: winReturn - sStake,
    bookMiss: -sStake,
    equalizeN: winReturn,
  };
}

// Auto contracts cap for a hedge mode. Fill odds already include the maker fee.
// Cash 1× = stake × decimal (equalize). Free bet 1× = (D−1)×FB (equalize; miss is already $0).
export function hedgeCap({ stake, boostAmerican, fillAmerican, mode = "1x", kind } = {}) {
  if (!(stake > 0) || !boostAmerican || !fillAmerican) return 0;
  const book = bookPnL({ stake, american: boostAmerican, kind });
  if (!book) return 0;
  const s = impliedProb(fillAmerican);
  switch (String(mode)) {
    case "riskfree":
      // Cash: fewest contracts so miss ≥ $0. Free bet miss is already $0 — keep upside (0 contracts).
      if (book.kind === "freebet") return 0;
      return s > 0 ? Math.ceil(book.stake / s) : 0;
    case "2x": return Math.round(2 * book.equalizeN);
    case "3x": return Math.round(3 * book.equalizeN);
    case "1x":
    default: return Math.round(book.equalizeN);
  }
}

// UI / simulate decide-at-fill (partial fill up to the mode cap). Worker engine.js
// additionally enforces a cumulative ceiling and full-RFQ-only; it still sizes
// from max_contracts, which we persist from this hedgeCap.
export function decideAtFill({
  parlayStake,
  parlayAmerican,
  fillAmerican,
  fairAmerican = null,
  rfqContracts,
  hedgeMode = "1x",
  kind,
} = {}) {
  const book = bookPnL({ stake: parlayStake, american: parlayAmerican, kind });
  if (!book || !fillAmerican) return { ok: false, reason: "bad_inputs" };
  const cap = hedgeCap({
    stake: parlayStake,
    boostAmerican: parlayAmerican,
    fillAmerican,
    mode: hedgeMode,
    kind,
  });
  const want = toNum(rfqContracts);
  if (!(want > 0) && !(book.kind === "freebet" && want === 0 && String(hedgeMode) === "riskfree")) {
    return { ok: false, reason: "bad_inputs" };
  }
  const N = Math.min(Math.max(0, want || 0), cap);
  if (!(N > 0) && !(book.kind === "freebet" && N === 0)) {
    return { ok: false, reason: "zero_cap", cap };
  }
  const s = impliedProb(fillAmerican);
  const hit = book.bookHit + N * s - N;
  const miss = book.bookMiss + N * s;
  const worst = Math.min(hit, miss);
  return {
    ok: true,
    locks: worst >= 0,
    hit: r2(hit),
    miss: r2(miss),
    worst: r2(worst),
    partial: (want || 0) > cap,
    cap,
    hedgeMode,
    kind: book.kind,
    competitive: fairAmerican == null ? null : fillAmerican >= fairAmerican,
    fillAmerican,
    contracts: N,
  };
}

function conversionText(stake, lockedCash, upside) {
  const rate = stake > 0 ? lockedCash / stake : 0;
  const pct = `${(rate * 100).toFixed(1)}% conversion`;
  if (!(upside > 0.004)) return `${pct} locked`;
  return `${pct} · ${moneyAbs(upside)} unhedged upside`;
}

// Original soft-book / promo lock stake at the user's odds — not the RFQ fill.
// Omit rather than show junk when either field is missing.
export function formatStakeOddsChip(parlay) {
  if (!parlay) return null;
  const stake = toNum(parlay.parlay_stake);
  const american = formatAmericanOdds(parlay.parlay_american);
  if (!(stake > 0) || !american) return null;
  const prefix = isFreeBetLock(parlay) ? "free bet" : "stake";
  return `${prefix} ${moneyAbs(stake)} @ ${american}`;
}

export function signedMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(2);
  return (n < 0 ? "-$" : "+$") + abs;
}

export function hedgePayoffs({ stake, american, fillAmerican, contracts, kind } = {}) {
  const book = bookPnL({ stake, american, kind });
  const n = toNum(contracts);
  if (!book || !(n >= 0)) return null;
  if (!(n > 0) || fillAmerican == null || fillAmerican === "") {
    return {
      contracts: n || 0,
      kind: book.kind,
      hit: r2(book.bookHit),
      miss: r2(book.bookMiss),
      worst: r2(Math.min(book.bookHit, book.bookMiss)),
    };
  }
  const sFill = toNum(fillAmerican);
  if (sFill == null) return null;
  const s = impliedProb(sFill);
  if (!(s > 0 && s < 1)) return null;
  const hit = book.bookHit + n * s - n;
  const miss = book.bookMiss + n * s;
  return {
    contracts: n,
    fillAmerican: sFill,
    kind: book.kind,
    hit: r2(hit),
    miss: r2(miss),
    worst: r2(Math.min(hit, miss)),
  };
}

export function currentUnhedged(parlay) {
  if (!parlay) return null;
  const kind = lockKind(parlay);
  const book = bookPnL({ stake: parlay.parlay_stake, american: parlay.parlay_american, kind });
  if (!book) return null;
  const profit = r2(book.bookHit);
  if (kind === "freebet") {
    return {
      stake: book.stake,
      american: book.american,
      kind,
      risk: 0,
      profit,
      hit: profit,
      miss: 0,
      conversionRate: 0,
      lockedCash: 0,
      unhedgedUpside: profit,
      text: conversionText(book.stake, 0, profit),
    };
  }
  return {
    stake: book.stake,
    american: book.american,
    kind: "cash",
    risk: book.stake,
    profit,
    hit: profit,
    miss: r2(book.bookMiss),
    text: `risk ${moneyAbs(book.stake)} for ${moneyAbs(profit)} profit`,
  };
}

// Book + fills so far. Headline uses remaining worst-case abs(miss) when still at risk.
export function currentStanding(unhedged, soFar) {
  if (!unhedged || !soFar) return unhedged || null;
  const hit = soFar.hit;
  const miss = soFar.miss;
  if (unhedged.kind === "freebet") {
    const worst = Math.min(hit, miss);
    const lockedCash = worst > 0 ? r2(worst) : 0;
    const unhedgedUpside = r2(Math.abs(hit - miss));
    return {
      stake: unhedged.stake,
      american: unhedged.american,
      kind: "freebet",
      risk: miss < 0 ? r2(Math.abs(miss)) : 0,
      profit: hit,
      hit,
      miss,
      conversionRate: unhedged.stake > 0 ? lockedCash / unhedged.stake : 0,
      lockedCash,
      unhedgedUpside,
      text: conversionText(unhedged.stake, lockedCash, unhedgedUpside),
      standing: true,
    };
  }
  const remainingRisk = miss < 0 ? r2(Math.abs(miss)) : 0;
  const text = miss < 0
    ? `risk ${moneyAbs(remainingRisk)} for ${moneyAbs(hit)} profit`
    : `standing ${signedMoney(hit)} / ${signedMoney(miss)}`;
  return {
    stake: unhedged.stake,
    american: unhedged.american,
    kind: "cash",
    risk: remainingRisk,
    profit: hit,
    hit,
    miss,
    text,
    standing: true,
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
    kind: lockKind(parlay),
  });
  if (!pay) return null;
  return {
    ...pay,
    locks: pay.worst >= 0,
    fairAmerican: toNum(parlay.fair_american),
  };
}

export function lockProfile(parlay, filled = 0) {
  const unhedged = currentUnhedged(parlay);
  const target = targetHedge(parlay);
  const filledN = Math.max(0, toNum(filled) || 0);
  const targetN = target ? target.contracts : null;
  const soFar = unhedged
    ? hedgePayoffs({
      stake: parlay.parlay_stake,
      american: parlay.parlay_american,
      fillAmerican: parlay.fill_american,
      contracts: filledN,
      kind: lockKind(parlay),
    })
    : null;
  const current = filledN > 0 && soFar && unhedged
    ? currentStanding(unhedged, soFar)
    : unhedged;
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
