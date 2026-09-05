// Running P/L from Combo Locks history.
// Locked fills use soFar payoffs (actual filled contracts). Settled unfilled
// locks use the current unhedged risk profile. Official Kalshi combo result
// wins over underlying (Kalshi legs / ESPN). Never invents a score.

import { lockProfile } from "./comboLockProfile.js";
import { historyOutcome, settlementFromStored, settlementCopy } from "./comboSettlement.js";
import { underlyingCopy } from "./comboLegResult.js";

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function r2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function filledContracts(parlay, fillsById = {}) {
  if (!parlay) return 0;
  const fromMap = toNum(fillsById[parlay.id]);
  if (fromMap != null && fromMap > 0) return fromMap;
  return 0;
}

function payoffsForLine(profile, filled) {
  if (!profile) return null;
  if (filled > 0 && profile.soFar) return profile.soFar;
  return profile.current;
}

function pnlFromPayoffs(pay, side) {
  if (!pay) return null;
  if (side === "hit") return r2(pay.hit);
  if (side === "miss") return r2(pay.miss);
  if (side === "push") return 0;
  return null;
}

// Official combo: we sold NO, so weWon (parlay lost) = miss; parlay won = hit.
function sideFromOfficial(settlement) {
  if (!settlement) return null;
  return settlement.weWon ? "miss" : "hit";
}

function sideFromUnderlying(outcome) {
  if (outcome === "won") return "hit";
  if (outcome === "lost") return "miss";
  if (outcome === "push") return "push";
  return null;
}

export function lockStatementLine({
  parlay,
  filled = 0,
  fills = [],
  outcomes = [],
  matches = [],
  submissions = [],
  liveResult,
} = {}) {
  if (!parlay) return null;
  const filledN = Math.max(0, toNum(filled) || 0);
  const profile = lockProfile(parlay, filledN);
  const outcome = historyOutcome({
    parlay,
    liveResult,
    fills,
    outcomes,
    matches,
    submissions,
    filled: filledN,
  });
  const pay = payoffsForLine(profile, filledN);
  const official = (outcome && outcome.kind === "result" && outcome.settlement)
    || settlementFromStored(parlay)
    || settlementCopy(liveResult);
  let side = null;
  let resultKind = "pending";
  let resultLabel = "pending";
  let source = null;

  if (official) {
    side = sideFromOfficial(official);
    resultKind = "official";
    resultLabel = official.weWon ? "parlay lost (we won)" : "parlay won (we lost)";
    source = "kalshi_combo";
  } else if (outcome && outcome.kind === "underlying") {
    side = sideFromUnderlying(outcome.outcome);
    resultKind = "underlying";
    const copy = underlyingCopy(outcome.outcome, { filled: filledN > 0 });
    resultLabel = copy ? copy.text : outcome.outcome;
    source = outcome.source || null;
  } else if (outcome && outcome.kind === "awaiting") {
    resultKind = "awaiting";
    resultLabel = "awaiting settlement";
  } else if (outcome && outcome.kind === "pending") {
    resultKind = "pending";
    resultLabel = "pending";
  } else {
    resultKind = "open";
    resultLabel = filledN > 0 ? "open lock" : "open";
  }

  const pnl = side ? pnlFromPayoffs(pay, side) : null;
  const settled = pnl != null && (resultKind === "official" || resultKind === "underlying");
  const bucket = !settled ? "pending"
    : filledN > 0 ? "locked_fill"
      : "unfilled";

  return {
    id: parlay.id,
    label: parlay.label || "Lock",
    filled: filledN,
    bucket,
    settled,
    pnl,
    resultKind,
    resultLabel,
    source,
    profile,
    at: parlay.archived_at || parlay.settled_at || parlay.underlying_settled_at || parlay.created_at || null,
  };
}

export function buildComboStatement({
  parlays = [],
  fillsById = {},
  fills = [],
  outcomes = [],
  matchesByParlay = {},
  submissions = [],
  liveSettlement = {},
} = {}) {
  const lines = (parlays || []).map((parlay) => lockStatementLine({
    parlay,
    filled: filledContracts(parlay, fillsById),
    fills,
    outcomes,
    matches: (matchesByParlay && parlay && matchesByParlay[parlay.id]) || [],
    submissions,
    liveResult: liveSettlement && parlay ? liveSettlement[parlay.id] && liveSettlement[parlay.id].result : undefined,
  })).filter(Boolean);

  lines.sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0;
    const tb = b.at ? Date.parse(b.at) : 0;
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });

  let realized = 0;
  let lockedFillPnl = 0;
  let unfilledPnl = 0;
  let pending = 0;
  let lockedFills = 0;
  let unfilledSettled = 0;
  for (const line of lines) {
    if (line.settled && line.pnl != null) {
      realized = r2(realized + line.pnl);
      if (line.bucket === "locked_fill") {
        lockedFillPnl = r2(lockedFillPnl + line.pnl);
        lockedFills += 1;
      } else if (line.bucket === "unfilled") {
        unfilledPnl = r2(unfilledPnl + line.pnl);
        unfilledSettled += 1;
      }
    } else {
      pending += 1;
    }
  }

  return {
    lines,
    realized,
    lockedFillPnl,
    unfilledPnl,
    pending,
    lockedFills,
    unfilledSettled,
    count: lines.length,
  };
}

export function formatStatementPnl(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(2);
  return (n < 0 ? "-$" : "+$") + abs;
}
