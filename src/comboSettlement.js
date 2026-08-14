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

function rfqsAndQuotes({ parlay, fills = [], matches = [] } = {}) {
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
  return { rfqs, quotes };
}

export function resolveComboTicker({ parlay, fills = [], outcomes = [], matches = [] } = {}) {
  if (!parlay) return null;
  if (parlay.combo_ticker) return String(parlay.combo_ticker);
  const fromFills = (fills || [])
    .filter((f) => f && f.parlay_id === parlay.id)
    .map(tickerFromRecord)
    .filter(Boolean);
  if (fromFills.length) return mostCommon(fromFills);
  const { rfqs, quotes } = rfqsAndQuotes({ parlay, fills, matches });
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
