// Combo Locks settlement — official Kalshi combo/MVE market result only.
// Kevin sells NO, so Kalshi yes = parlay won (we lost), no = parlay lost (we won).
// Never infer from start times or game clocks.

const YES_NO = new Set(["yes", "no"]);
// Result is published at `determined`; `finalized` / `amended` keep that official result.
const DETERMINED_STATUS = new Set(["determined", "finalized", "amended"]);

function norm(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

export function settlementCopy(result) {
  const r = norm(result);
  if (r === "yes") return { result: "yes", text: "parlay won (we lost)", weWon: false };
  if (r === "no") return { result: "no", text: "parlay lost (we won)", weWon: true };
  return null;
}

export function settlementFromStored(parlay) {
  if (!parlay) return null;
  return settlementCopy(parlay.kalshi_result);
}

export function isOfficialSettlement(market) {
  if (!market) return false;
  const status = norm(market.status);
  const result = norm(market.result);
  return DETERMINED_STATUS.has(status) && YES_NO.has(result);
}

export function marketSettlement(market) {
  if (!isOfficialSettlement(market)) return null;
  return settlementCopy(market.result);
}

function nestedTicker(obj) {
  if (!obj || typeof obj !== "object") return null;
  const direct = obj.ticker || obj.market_ticker || obj.combo_ticker;
  if (direct) return String(direct);
  if (obj.msg && typeof obj.msg === "object") {
    const nested = obj.msg.market_ticker || obj.msg.ticker;
    if (nested) return String(nested);
  }
  if (obj.raw && typeof obj.raw === "object") return nestedTicker(obj.raw);
  return null;
}

export function tickerFromRecord(row) {
  return nestedTicker(row);
}

function mostCommon(values) {
  const counts = new Map();
  let best = null;
  let bestN = 0;
  for (const v of values) {
    if (!v) continue;
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function sameParlay(row, parlay) {
  if (!parlay || !parlay.id) return true;
  return !row || !row.parlay_id || row.parlay_id === parlay.id;
}

function tickersForParlay(rows, parlay) {
  return (rows || [])
    .filter((row) => row && sameParlay(row, parlay))
    .map(tickerFromRecord)
    .filter(Boolean);
}

function isShadowSubmission(row) {
  return String(row && row.status != null ? row.status : "").trim().toLowerCase() === "shadow";
}

function rfqsAndQuotes({ parlay, fills = [], matches = [], submissions = [] } = {}) {
  const rfqs = new Set();
  const quotes = new Set();
  (matches || []).forEach((m) => {
    if (m && m.rfq_id) rfqs.add(m.rfq_id);
  });
  const pid = parlay && parlay.id;
  (fills || []).forEach((f) => {
    if (!f || f.parlay_id !== pid) return;
    const rfq = f.rfq_id || (f.raw && (f.raw.rfq_id || (f.raw.msg && f.raw.msg.rfq_id)));
    if (rfq) rfqs.add(rfq);
    const qid = f.quote_id || (f.raw && (f.raw.quote_id || (f.raw.msg && f.raw.msg.quote_id)));
    if (qid) quotes.add(qid);
  });
  (submissions || []).forEach((s) => {
    if (!s || !sameParlay(s, parlay) || isShadowSubmission(s)) return;
    if (s.rfq_id) rfqs.add(s.rfq_id);
    if (s.quote_id) quotes.add(s.quote_id);
  });
  return { rfqs, quotes };
}

export function resolveComboTicker({ parlay, fills = [], outcomes = [], matches = [], submissions = [] } = {}) {
  if (!parlay) return null;
  if (parlay.combo_ticker) return String(parlay.combo_ticker);
  const fromFills = (fills || [])
    .filter((f) => f && f.parlay_id === parlay.id)
    .map(tickerFromRecord)
    .filter(Boolean);
  if (fromFills.length) return mostCommon(fromFills);
  // combo_matches may carry ticker / market_ticker; quote-watcher upserts did not.
  const fromMatches = tickersForParlay(matches, parlay);
  if (fromMatches.length) return mostCommon(fromMatches);
  // skip-tape writes market_ticker on quoted / skipped / unfilled combo_submissions.
  const fromSubs = tickersForParlay((submissions || []).filter((s) => s && !isShadowSubmission(s)), parlay);
  if (fromSubs.length) return mostCommon(fromSubs);
  const { rfqs, quotes } = rfqsAndQuotes({ parlay, fills, matches, submissions });
  const linked = (outcomes || []).filter((o) => o && (
    o.parlay_id === parlay.id
    || (o.rfq_id && rfqs.has(o.rfq_id))
    || (o.quote_id && quotes.has(o.quote_id))
  ));
  const fromOutcomes = linked.map(tickerFromRecord).filter(Boolean);
  if (fromOutcomes.length) return mostCommon(fromOutcomes);
  // Do not reconstruct from individual parlay legs — those are single-game markets.
  return null;
}

// History Outcome: official combo result, else stamped underlying (Kalshi legs / ESPN),
// else awaiting a combo ticker, else pending legs, else dash. Never invents a score.
export function historyOutcome({ parlay, liveResult, fills = [], outcomes = [], matches = [], submissions = [], filled = 0 } = {}) {
  const stored = settlementFromStored(parlay) || settlementCopy(liveResult);
  if (stored) return { kind: "result", settlement: stored };
  const underlying = parlay && String(parlay.underlying_result || "").trim().toLowerCase();
  if (underlying === "won" || underlying === "lost" || underlying === "push") {
    return {
      kind: "underlying",
      outcome: underlying,
      filled: (Number(filled) || 0) > 0,
      source: parlay.underlying_source || null,
    };
  }
  const ticker = resolveComboTicker({ parlay, fills, outcomes, matches, submissions });
  if (ticker) return { kind: "awaiting", ticker };
  if (parlay && Array.isArray(parlay.legs) && parlay.legs.length >= 2) return { kind: "pending" };
  return { kind: "none" };
}
