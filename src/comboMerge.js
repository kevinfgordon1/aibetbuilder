// Merge duplicate Combo Locks parlays into one hedge order.
//
// combo-worker (engine.js hedgeCap / decideAtFill) never reads is_free_bet.
// It always does:
//   winReturn = stake * decimal(american)
//   bookHit   = winReturn - stake
//   bookMiss  = -stake
//   1× cap    = round(winReturn)
// and then sells min(remaining max_contracts, that cap).
//
// A merged order is therefore written back onto the SAME combo_parlays columns:
//   any cash at risk → stake = total_at_risk, american = profit/risk, is_free_bet false
//   all free bets    → stake = sum of free face values, american = profit/stake, is_free_bet true
//                       max_contracts = profit (the free-bet equalize). The worker's own
//                       cash cap is larger; max_contracts is the binding ceiling.
// Originals live in combo_parlay_bets so weekly book P&L can still see each ticket.

import { hedgeCap } from "./comboLockProfile.js";

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

export function aToDec(a) {
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

function impliedProb(a) {
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
}

export function formatDollars(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$0";
  if (Math.abs(n - Math.round(n)) < 1e-9) return "$" + Math.round(n);
  return "$" + n.toFixed(2);
}

export function displayAmerican(american) {
  const n = toNum(american);
  if (n == null || n === 0) return null;
  const rounded = Math.round(n);
  if (!rounded) return null;
  return rounded;
}

export function formatAmerican(american) {
  const n = displayAmerican(american);
  if (n == null) return "—";
  return n > 0 ? "+" + n : "" + n;
}

// profit/risk as American, unrounded so stake * decimal reproduces profit.
export function americanFromProfit(profit, risk) {
  if (!(profit > 0) || !(risk > 0)) return null;
  const ratio = profit / risk;
  if (ratio >= 1) return (profit / risk) * 100;
  return -100 * (risk / profit);
}

export function normalizeBetType(bet) {
  if (!bet || typeof bet !== "object") return "cash";
  const raw = String(bet.bet_type || bet.betType || bet.kind || "").trim().toLowerCase();
  if (raw === "free" || raw === "freebet" || raw === "free_bet") return "free";
  if (bet.is_free_bet === true || bet.isFreeBet === true) return "free";
  if (raw === "boost" || raw === "profit_boost" || raw === "profit-boost") return "boost";
  return "cash";
}

export function betEconomics(bet) {
  const stake = toNum(bet && (bet.stake != null ? bet.stake : bet.parlay_stake));
  const american = toNum(bet && (bet.american != null ? bet.american : bet.parlay_american));
  if (!(stake > 0) || american == null || american === 0) return null;
  const type = normalizeBetType(bet);
  const profit = roundMoney(stake * (aToDec(american) - 1));
  const atRisk = type === "free" ? 0 : roundMoney(stake);
  const boostPct = toNum(bet.boost_pct != null ? bet.boost_pct : bet.boostPct);
  return {
    stake: roundMoney(stake),
    american,
    type,
    profit,
    atRisk,
    sportsbook: bet.sportsbook ? String(bet.sportsbook).trim() : "",
    boostPct,
    createdAt: bet.created_at || bet.createdAt || bet.placed_at || null,
  };
}

export function mergeEconomics(bets) {
  const parts = (bets || []).map(betEconomics).filter(Boolean);
  if (!parts.length) return null;
  const totalAtRisk = roundMoney(parts.reduce((sum, p) => sum + p.atRisk, 0));
  const totalProfit = roundMoney(parts.reduce((sum, p) => sum + p.profit, 0));
  const allFree = !(totalAtRisk > 0);
  const freeStake = roundMoney(parts.filter((p) => p.type === "free").reduce((sum, p) => sum + p.stake, 0));
  const denom = allFree ? freeStake : totalAtRisk;
  const trueAmericanExact = americanFromProfit(totalProfit, denom);
  return {
    parts,
    totalAtRisk,
    totalProfit,
    allFree,
    freeStake,
    trueAmericanExact,
    displayAmerican: displayAmerican(trueAmericanExact),
    isFreeBet: allFree,
    count: parts.length,
  };
}

// What combo-worker engine.js computes from the stored row (cash formula).
// 1× per-fill cap ignores the fill PRICE (it only requires a fill to be set).
export function workerCashPosition({ stake, american, fillAmerican, mode = "1x", maxContracts = null } = {}) {
  const sStake = toNum(stake);
  const sAm = toNum(american);
  const sFill = toNum(fillAmerican);
  if (!(sStake > 0) || sAm == null || sAm === 0 || sFill == null || sFill === 0) return null;
  const winReturn = sStake * aToDec(sAm);
  const bookHit = winReturn - sStake;
  const bookMiss = -sStake;
  const s = impliedProb(sFill);
  let perFillCap = 0;
  switch (String(mode || "1x")) {
    case "riskfree":
      perFillCap = s > 0 ? Math.ceil(sStake / s) : 0;
      break;
    case "2x":
      perFillCap = Math.round(2 * winReturn);
      break;
    case "3x":
      perFillCap = Math.round(3 * winReturn);
      break;
    case "1x":
    default:
      perFillCap = Math.round(winReturn);
  }
  const ceiling = maxContracts != null && Number(maxContracts) > 0 ? Math.round(Number(maxContracts)) : perFillCap;
  const effectiveCap = Math.min(ceiling, perFillCap);
  const hit = bookHit + effectiveCap * s - effectiveCap;
  const miss = bookMiss + effectiveCap * s;
  return {
    bookHit,
    bookMiss,
    perFillCap,
    ceiling,
    effectiveCap,
    hit,
    miss,
    locks: Math.min(hit, miss) >= -0.02,
  };
}

export function encodeMergedParlay(econ, { fillAmerican, hedgeMode = "1x" } = {}) {
  if (!econ) return null;
  const mode = hedgeMode || "1x";
  const fill = toNum(fillAmerican);
  if (econ.allFree) {
    const stake = econ.freeStake;
    const american = econ.trueAmericanExact;
    const cap = hedgeCap({
      stake,
      boostAmerican: american,
      fillAmerican: fill,
      mode,
      kind: "freebet",
    });
    return {
      parlay_stake: stake,
      parlay_american: american,
      is_free_bet: true,
      bet_type: "free",
      max_contracts: cap,
      hedge_mode: mode,
    };
  }
  const stake = econ.totalAtRisk;
  const american = econ.trueAmericanExact;
  const cap = hedgeCap({
    stake,
    boostAmerican: american,
    fillAmerican: fill,
    mode,
    kind: "cash",
  });
  const types = new Set((econ.parts || []).map((p) => p.type));
  const betType = types.size > 1 ? "hybrid" : (types.values().next().value || "cash");
  return {
    parlay_stake: stake,
    parlay_american: american,
    is_free_bet: false,
    bet_type: betType,
    max_contracts: cap,
    hedge_mode: mode,
  };
}

export function bindingCap(parlay) {
  if (!parlay) return null;
  return workerCashPosition({
    stake: parlay.parlay_stake,
    american: parlay.parlay_american,
    fillAmerican: parlay.fill_american,
    mode: parlay.hedge_mode || "1x",
    maxContracts: parlay.max_contracts,
  });
}

// Quote-execution stubs do not count. Mirrors combo-worker fills-attr.js countsTowardCap.
export function countsTowardCap(row) {
  if (!row) return false;
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  const id = String(row.fill_id || "");
  if (raw.venue === "polymarket" || row.venue === "polymarket" || id.startsWith("poly-")) return true;
  if (raw.source === "live-runner") return false;
  if (row.fill_id && row.order_id && row.fill_id === row.order_id && !raw.trade_id && raw.count_fp == null) return false;
  return true;
}

export function fillKey(row) {
  if (!row) return "";
  if (row.fill_id) return String(row.fill_id);
  if (row.id) return "id:" + row.id;
  return "";
}

export function countingFillKeys(fills) {
  const keys = [];
  for (const row of fills || []) {
    if (!countsTowardCap(row)) continue;
    const key = fillKey(row);
    if (key) keys.push(key);
  }
  return keys;
}

const MONTHS = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const TICKER_START_RE = /(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(\d{4})/i;

function nthSunday(year, monthIndex, n) {
  const dow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const firstSunday = dow === 0 ? 1 : 8 - dow;
  return firstSunday + (n - 1) * 7;
}

function easternOffsetHours(year, month, day, hour) {
  const mar = nthSunday(year, 2, 2);
  const nov = nthSunday(year, 10, 1);
  let dst = false;
  if (month > 3 && month < 11) dst = true;
  else if (month === 3) dst = day > mar || (day === mar && hour >= 2);
  else if (month === 11) dst = day < nov || (day === nov && hour < 2);
  return dst ? 4 : 5;
}

// Same Kalshi ticker clock as combo-worker/started.js (America/New_York wall time).
export function parseKalshiTickerStart(text) {
  if (text == null) return null;
  const m = TICKER_START_RE.exec(String(text));
  if (!m) return null;
  const year = 2000 + parseInt(m[1], 10);
  const month = MONTHS[m[2].toUpperCase()];
  const day = parseInt(m[3], 10);
  const hour = parseInt(m[4].slice(0, 2), 10);
  const minute = parseInt(m[4].slice(2, 4), 10);
  if (!month || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const off = easternOffsetHours(year, month, day, hour);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` +
    `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-0${off}:00`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function parseTs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export function gameHasStarted(parlay, now = Date.now()) {
  if (!parlay) return false;
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const times = [];
  const starts = parseTs(parlay.starts_at);
  if (starts != null) times.push(starts);
  const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
  for (const leg of legs) {
    if (!leg) continue;
    if (typeof leg === "string") {
      const t = parseKalshiTickerStart(leg);
      if (t != null) times.push(t);
      continue;
    }
    for (const key of ["starts_at", "start_time", "commence_time", "event_start_time"]) {
      const t = parseTs(leg[key]);
      if (t != null) times.push(t);
    }
    const tickerMs = parseKalshiTickerStart(leg.ticker || leg.gameKey || leg.game_key);
    if (tickerMs != null) times.push(tickerMs);
  }
  const keys = Array.isArray(parlay.leg_keys) ? parlay.leg_keys : [];
  for (const key of keys) {
    const t = parseKalshiTickerStart(key);
    if (t != null) times.push(t);
  }
  return times.some((t) => t <= nowMs);
}

export function legSignature(parlayOrLegs) {
  const parlay = Array.isArray(parlayOrLegs) ? { legs: parlayOrLegs } : (parlayOrLegs || {});
  const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
  if (legs.length) {
    const keys = [];
    for (const leg of legs) {
      if (!leg) return "";
      const ticker = String(leg.ticker || "").trim().toUpperCase();
      const side = String(leg.side || "").trim().toLowerCase();
      if (!ticker || !side) return "";
      keys.push(`${ticker}:${side}`);
    }
    return keys.sort().join("|");
  }
  const raw = Array.isArray(parlay.leg_keys) ? parlay.leg_keys : [];
  if (!raw.length) return "";
  const keys = raw.map((key) => {
    const text = String(key || "").trim();
    const i = text.lastIndexOf(":");
    if (i < 0) return text.toUpperCase();
    return `${text.slice(0, i).toUpperCase()}:${text.slice(i + 1).toLowerCase()}`;
  }).filter(Boolean);
  if (!keys.length) return "";
  return keys.sort().join("|");
}

export function isAbsorbedParlay(parlay) {
  return !!(parlay && parlay.merged_into_id);
}

export function isOpenForMerge(parlay, now = Date.now()) {
  if (!parlay || parlay.archived_at || parlay.merged_into_id) return false;
  if (parlay.active === false) return false;
  if (!legSignature(parlay)) return false;
  if (gameHasStarted(parlay, now)) return false;
  return true;
}

export function parlayShortName(parlay) {
  const legs = (parlay && parlay.legs) || [];
  const codes = legs.map((leg) => {
    const ticker = String((leg && leg.ticker) || "");
    const last = ticker.split("-").pop() || "";
    if (/^[A-Za-z]{2,4}$/.test(last)) return last.toUpperCase();
    const label = String((leg && leg.label) || "").trim();
    const m = label.match(/^([A-Za-z]{2,4})\b/);
    return m ? m[1].toUpperCase() : "";
  }).filter(Boolean);
  if (legs.length >= 2 && codes.length === legs.length) return codes.join("/");
  const label = String((parlay && parlay.label) || "").trim();
  if (!label) return "this parlay";
  const parts = label.split(/\s+\+\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.join("/") : label;
}

export function duplicateWarning(existing) {
  const name = parlayShortName(existing);
  const stake = formatDollars(existing && existing.parlay_stake);
  const odds = formatAmerican(existing && existing.parlay_american);
  return `You already have ${name} (${stake} at ${odds}). Merge into one order?`;
}

export function betFromParlay(parlay) {
  if (!parlay) return null;
  const type = parlay.bet_type && parlay.bet_type !== "hybrid"
    ? normalizeBetType(parlay)
    : (parlay.is_free_bet ? "free" : (toNum(parlay.boost_pct) > 0 ? "boost" : "cash"));
  return {
    stake: toNum(parlay.parlay_stake),
    american: toNum(parlay.parlay_american),
    bet_type: type,
    sportsbook: parlay.sportsbook || null,
    boost_pct: toNum(parlay.boost_pct),
    created_at: parlay.created_at || null,
    source_parlay_id: parlay.id || null,
  };
}

function betsFor(parlayId, existingBets) {
  return (existingBets || []).filter((b) => b && String(b.parlay_id) === String(parlayId));
}

function emptyToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function normalizeIncomingBet(bet, nowIso) {
  const type = normalizeBetType(bet);
  return {
    stake: toNum(bet && (bet.stake != null ? bet.stake : bet.parlay_stake)),
    american: toNum(bet && (bet.american != null ? bet.american : bet.parlay_american ?? bet.boost)),
    bet_type: type,
    sportsbook: emptyToNull(bet && bet.sportsbook),
    boost_pct: toNum(bet && (bet.boost_pct != null ? bet.boost_pct : bet.boostPct)),
    created_at: (bet && (bet.created_at || bet.createdAt)) || nowIso,
    fill_american: toNum(bet && (bet.fill_american != null ? bet.fill_american : bet.fillAmerican ?? bet.fill)),
    fair_american: toNum(bet && (bet.fair_american != null ? bet.fair_american : bet.fairAmerican ?? bet.fair)),
    hedge_mode: (bet && (bet.hedge_mode || bet.hedgeMode || bet.mode)) || null,
    label: emptyToNull(bet && bet.label),
  };
}

function singleCap(parlay, bet) {
  const fill = toNum(parlay && parlay.fill_american) || toNum(bet.fill_american) || 100;
  const mode = (parlay && parlay.hedge_mode) || bet.hedge_mode || "1x";
  const kind = bet.bet_type === "free" ? "freebet" : "cash";
  return hedgeCap({
    stake: bet.stake,
    boostAmerican: bet.american,
    fillAmerican: fill,
    mode,
    kind,
  });
}

function newBetSnapshot(survivor, bet) {
  const fill = bet.fill_american != null ? bet.fill_american : survivor.fill_american;
  const mode = bet.hedge_mode || survivor.hedge_mode || "1x";
  const cap = hedgeCap({
    stake: bet.stake,
    boostAmerican: bet.american,
    fillAmerican: fill,
    mode,
    kind: bet.bet_type === "free" ? "freebet" : "cash",
  });
  return {
    label: bet.label || survivor.label || "",
    legs: survivor.legs || [],
    leg_keys: survivor.leg_keys || [],
    mve_collection: survivor.mve_collection || null,
    starts_at: survivor.starts_at || null,
    fill_american: fill,
    fair_american: bet.fair_american != null ? bet.fair_american : null,
    hedge_mode: mode,
    parlay_stake: bet.stake,
    parlay_american: Math.round(bet.american),
    is_free_bet: bet.bet_type === "free",
    bet_type: bet.bet_type,
    sportsbook: bet.sportsbook,
    boost_pct: bet.boost_pct,
    max_contracts: cap,
    active: true,
    archived_at: null,
    merged_into_id: null,
    user_id: survivor.user_id,
  };
}

function componentRow({ userId, parlayId, batchId, role, bet, snapshot, createdInBatch }) {
  return {
    user_id: userId,
    parlay_id: parlayId,
    source_parlay_id: bet.source_parlay_id || null,
    role,
    stake: bet.stake,
    american: bet.american,
    bet_type: bet.bet_type,
    sportsbook: bet.sportsbook || null,
    boost_pct: bet.boost_pct != null ? bet.boost_pct : null,
    created_at: bet.created_at || new Date().toISOString(),
    merge_batch_id: batchId,
    created_in_batch: createdInBatch,
    source_snapshot: snapshot || null,
  };
}

const HEDGE_TABLES = ["combo_fills", "combo_submissions", "combo_matches", "quote_outcomes"];

export function buildMergePlan({
  survivor,
  absorb = [],
  newBet = null,
  existingBets = [],
  fills = [],
  submissions = [],
  matches = [],
  outcomes = [],
  now = new Date(),
  batchId,
} = {}) {
  if (!survivor || !survivor.id) return { ok: false, error: "Pick the order to merge into." };
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const nowMs = Date.parse(nowIso);
  if (!isOpenForMerge(survivor, nowMs)) {
    return { ok: false, error: "That order is archived, paused, or a game has already started." };
  }
  const sig = legSignature(survivor);
  const folding = (absorb || []).filter((row) => row && row.id && row.id !== survivor.id);
  if (!folding.length && !newBet) return { ok: false, error: "Nothing to merge." };
  for (const row of folding) {
    if (row.user_id && survivor.user_id && row.user_id !== survivor.user_id) {
      return { ok: false, error: "Those parlays belong to different accounts." };
    }
    if (legSignature(row) !== sig) return { ok: false, error: "Those parlays are not the same legs." };
    if (!isOpenForMerge(row, nowMs)) {
      return { ok: false, error: "One of those orders is archived, paused, or a game has already started." };
    }
  }
  if (newBet) {
    const incomingLegs = newBet.legs || null;
    if (incomingLegs && legSignature(incomingLegs) !== sig) {
      return { ok: false, error: "Those parlays are not the same legs." };
    }
  }

  const id = batchId || (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `batch-${nowMs}`);
  const insertBets = [];
  const reattachBets = [];
  const econBets = [];

  const own = betsFor(survivor.id, existingBets);
  if (own.length) {
    for (const row of own) econBets.push(row);
  } else {
    const bet = betFromParlay(survivor);
    econBets.push(bet);
    insertBets.push(componentRow({
      userId: survivor.user_id,
      parlayId: survivor.id,
      batchId: id,
      role: "survivor_snapshot",
      bet,
      snapshot: { ...survivor },
      createdInBatch: true,
    }));
  }

  for (const row of folding) {
    const prior = betsFor(row.id, existingBets);
    if (prior.length) {
      for (const bet of prior) {
        econBets.push(bet);
        reattachBets.push({ id: bet.id, parlay_id: survivor.id, from_parlay_id: row.id });
      }
    } else {
      const bet = betFromParlay(row);
      econBets.push(bet);
      insertBets.push(componentRow({
        userId: survivor.user_id,
        parlayId: survivor.id,
        batchId: id,
        role: "absorbed",
        bet,
        snapshot: { ...row },
        createdInBatch: true,
      }));
    }
  }

  if (newBet) {
    const bet = normalizeIncomingBet(newBet, nowIso);
    if (!(bet.stake > 0) || bet.american == null) return { ok: false, error: "Enter a stake and American odds to merge." };
    econBets.push(bet);
    insertBets.push(componentRow({
      userId: survivor.user_id,
      parlayId: survivor.id,
      batchId: id,
      role: "new_bet",
      bet,
      snapshot: newBetSnapshot(survivor, bet),
      createdInBatch: true,
    }));
  }

  const econ = mergeEconomics(econBets);
  if (!econ || econ.trueAmericanExact == null) return { ok: false, error: "Could not price that merge." };
  const encoded = encodeMergedParlay(econ, {
    fillAmerican: survivor.fill_american,
    hedgeMode: survivor.hedge_mode || "1x",
  });

  const absorbIds = folding.map((row) => row.id);
  const hedgeRows = {
    combo_fills: (fills || []).filter((row) => absorbIds.includes(row.parlay_id)),
    combo_submissions: (submissions || []).filter((row) => absorbIds.includes(row.parlay_id)),
    combo_matches: (matches || []).filter((row) => absorbIds.includes(row.parlay_id)),
    quote_outcomes: (outcomes || []).filter((row) => absorbIds.includes(row.parlay_id)),
  };
  const survivorMatchRfqs = new Set(
    (matches || []).filter((row) => row.parlay_id === survivor.id).map((row) => String(row.rfq_id || ""))
  );
  const repoints = [];
  const drops = [];
  for (const table of HEDGE_TABLES) {
    for (const row of hedgeRows[table]) {
      if (!row.id) continue;
      if (table === "combo_matches" && row.rfq_id && survivorMatchRfqs.has(String(row.rfq_id))) {
        drops.push(row);
        continue;
      }
      repoints.push({
        table,
        id: row.id,
        parlay_id: survivor.id,
        from_parlay_id: row.parlay_id,
      });
    }
  }

  const movedFillIds = new Set(hedgeRows.combo_fills.map((row) => row.id));
  const fillsAfter = (fills || []).filter((row) => row.parlay_id === survivor.id || movedFillIds.has(row.id));
  const fillIds = countingFillKeys(fillsAfter);

  const survivorBefore = {
    parlay_stake: survivor.parlay_stake,
    parlay_american: survivor.parlay_american,
    is_free_bet: survivor.is_free_bet === true,
    bet_type: survivor.bet_type || (survivor.is_free_bet ? "free" : "cash"),
    max_contracts: survivor.max_contracts,
    sportsbook: survivor.sportsbook || null,
    boost_pct: survivor.boost_pct != null ? survivor.boost_pct : null,
    merged_at: survivor.merged_at || null,
    merge_fill_ids: survivor.merge_fill_ids || null,
    active: survivor.active !== false,
    archived_at: survivor.archived_at || null,
    merged_into_id: survivor.merged_into_id || null,
    label: survivor.label || null,
    fill_american: survivor.fill_american,
    fair_american: survivor.fair_american != null ? survivor.fair_american : null,
    hedge_mode: survivor.hedge_mode || "1x",
  };

  return {
    ok: true,
    survivorId: survivor.id,
    warning: duplicateWarning(survivor),
    economics: econ,
    encoded,
    beforeCaps: [survivor, ...folding].map((row) => ({
      id: row.id,
      label: parlayShortName(row),
      stake: toNum(row.parlay_stake),
      american: toNum(row.parlay_american),
      cap: bindingCap(row) ? bindingCap(row).effectiveCap : null,
    })),
    afterCap: encoded.max_contracts,
    batch: {
      id,
      user_id: survivor.user_id,
      survivor_parlay_id: survivor.id,
      merged_at: nowIso,
      undone_at: null,
      survivor_before: survivorBefore,
      fill_ids: fillIds,
      absorb_snapshots: folding.map((row) => ({ ...row })),
      dropped_matches: drops,
    },
    insertBets,
    reattachBets,
    archive: folding.map((row) => ({
      id: row.id,
      patch: {
        active: false,
        archived_at: nowIso,
        merged_into_id: survivor.id,
      },
    })),
    repoints,
    dropMatchIds: drops.map((row) => row.id),
    moves: [
      ...repoints.map((row) => ({
        batch_id: id,
        user_id: survivor.user_id,
        table_name: row.table,
        pk_column: "id",
        row_pk: String(row.id),
        from_parlay_id: row.from_parlay_id,
        to_parlay_id: survivor.id,
      })),
      ...reattachBets.map((row) => ({
        batch_id: id,
        user_id: survivor.user_id,
        table_name: "combo_parlay_bets",
        pk_column: "id",
        row_pk: String(row.id),
        from_parlay_id: row.from_parlay_id,
        to_parlay_id: survivor.id,
      })),
    ],
    survivorPatch: {
      parlay_stake: encoded.parlay_stake,
      parlay_american: encoded.parlay_american,
      is_free_bet: encoded.is_free_bet,
      bet_type: encoded.bet_type,
      max_contracts: encoded.max_contracts,
      sportsbook: null,
      boost_pct: null,
      merged_at: nowIso,
      merge_fill_ids: fillIds,
      active: true,
      archived_at: null,
      merged_into_id: null,
    },
  };
}

export const UNDO_FILL_REASON = "Undo is disabled because a fill landed after this merge. Splitting now would let the worker hedge those contracts again.";

export function undoStatus({ mergedAt, fillIdsAtMerge, fills } = {}) {
  if (!mergedAt) return { ok: false, reason: "This order is not a merge." };
  if (!Array.isArray(fillIdsAtMerge)) {
    return { ok: false, reason: "Undo is disabled because this merge has no fill snapshot." };
  }
  const snap = new Set(fillIdsAtMerge.map(String));
  const extra = countingFillKeys(fills).filter((key) => !snap.has(key));
  if (extra.length) return { ok: false, reason: UNDO_FILL_REASON };
  return { ok: true, reason: "" };
}

export function buildUndoPlan({
  batch,
  survivor,
  bets = [],
  moves = [],
  fills = [],
  now = new Date(),
} = {}) {
  if (!batch || !survivor) return { ok: false, error: "Nothing to undo." };
  if (batch.undone_at) return { ok: false, error: "That merge was already undone." };
  const status = undoStatus({
    mergedAt: batch.merged_at || survivor.merged_at,
    fillIdsAtMerge: batch.fill_ids || survivor.merge_fill_ids,
    fills: (fills || []).filter((row) => row.parlay_id === survivor.id),
  });
  if (!status.ok) return { ok: false, error: status.reason };
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const batchMoves = (moves || []).filter((row) => !row.undone_at && String(row.batch_id) === String(batch.id));
  const created = (bets || []).filter((row) => row.created_in_batch && String(row.merge_batch_id) === String(batch.id));
  const insertParlays = [];
  for (const bet of created) {
    if (bet.role !== "new_bet") continue;
    const snap = bet.source_snapshot || {};
    insertParlays.push({
      ...snap,
      id: (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `split-${bet.id}`,
      user_id: survivor.user_id,
      active: true,
      archived_at: null,
      merged_into_id: null,
      merged_at: null,
      merge_fill_ids: null,
      created_at: bet.created_at || nowIso,
    });
  }
  const before = batch.survivor_before || {};
  const restore = [{
    id: survivor.id,
    patch: {
      parlay_stake: before.parlay_stake,
      parlay_american: before.parlay_american,
      is_free_bet: before.is_free_bet === true,
      bet_type: before.bet_type || "cash",
      max_contracts: before.max_contracts,
      sportsbook: before.sportsbook || null,
      boost_pct: before.boost_pct != null ? before.boost_pct : null,
      merged_at: before.merged_at || null,
      merge_fill_ids: before.merge_fill_ids || null,
      active: before.active !== false,
      archived_at: before.archived_at || null,
      merged_into_id: null,
      label: before.label || survivor.label,
      fill_american: before.fill_american,
      fair_american: before.fair_american != null ? before.fair_american : null,
      hedge_mode: before.hedge_mode || "1x",
    },
  }];
  for (const snap of batch.absorb_snapshots || []) {
    if (!snap || !snap.id) continue;
    restore.push({
      id: snap.id,
      patch: {
        parlay_stake: snap.parlay_stake,
        parlay_american: snap.parlay_american,
        is_free_bet: snap.is_free_bet === true,
        bet_type: snap.bet_type || (snap.is_free_bet ? "free" : "cash"),
        max_contracts: snap.max_contracts,
        sportsbook: snap.sportsbook || null,
        boost_pct: snap.boost_pct != null ? snap.boost_pct : null,
        active: true,
        archived_at: null,
        merged_into_id: null,
        merged_at: snap.merged_at || null,
        merge_fill_ids: snap.merge_fill_ids || null,
        label: snap.label,
        fill_american: snap.fill_american,
        fair_american: snap.fair_american != null ? snap.fair_american : null,
        hedge_mode: snap.hedge_mode || "1x",
      },
    });
  }
  return {
    ok: true,
    batchId: batch.id,
    undoneAt: nowIso,
    deleteBetIds: created.map((row) => row.id),
    insertParlays,
    restore,
    repoints: batchMoves
      .filter((row) => row.table_name !== "combo_parlay_bets")
      .map((row) => ({
        table: row.table_name,
        id: row.row_pk,
        parlay_id: row.from_parlay_id,
      })),
    reattachBets: batchMoves
      .filter((row) => row.table_name === "combo_parlay_bets")
      .map((row) => ({ id: row.row_pk, parlay_id: row.from_parlay_id })),
    reinsertMatches: batch.dropped_matches || [],
  };
}

export function findMergeTarget(parlays, legsOrParlay, now = Date.now()) {
  const sig = legSignature(legsOrParlay);
  if (!sig) return null;
  const hits = (parlays || []).filter((row) => isOpenForMerge(row, now) && legSignature(row) === sig);
  hits.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  return hits[0] || null;
}

export function findDuplicateGroups(parlays, now = Date.now()) {
  const buckets = new Map();
  for (const row of parlays || []) {
    if (!isOpenForMerge(row, now)) continue;
    const sig = legSignature(row);
    if (!sig) continue;
    if (!buckets.has(sig)) buckets.set(sig, []);
    buckets.get(sig).push(row);
  }
  const groups = [];
  for (const [signature, rows] of buckets) {
    if (rows.length < 2) continue;
    const ordered = rows.slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    groups.push({
      signature,
      survivor: ordered[0],
      others: ordered.slice(1),
      parlays: ordered,
      warning: duplicateWarning(ordered[0]),
    });
  }
  return groups;
}

export function originalBetResult(bet, won) {
  const econ = betEconomics(bet);
  if (!econ || won == null) return null;
  if (won === true) return econ.profit;
  return econ.type === "free" ? 0 : -econ.atRisk;
}

export function sortOriginalBets(bets) {
  return (bets || []).slice().sort((a, b) => String(a.created_at || a.createdAt || "").localeCompare(String(b.created_at || b.createdAt || "")));
}
