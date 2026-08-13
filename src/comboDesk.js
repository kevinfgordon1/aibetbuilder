// Combo Locks desk-strip mapping — pure helpers over data the page already polls
// (combo_parlays, combo_fills, combo_matches, quote_outcomes).
//
// Skips are matched RFQs the worker did not quote (especially oversized ones —
// Kalshi makers cannot partial-fill). Losses and tape clearing prices come from
// quote-watcher (loss_reason + tape_no_price, or raw.tape fallback).

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function tsMs(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

export function remainingFill({ filled = 0, ceiling = 0 } = {}) {
  const real = Math.max(0, toNum(filled) || 0);
  const cap = Math.max(0, toNum(ceiling) || 0);
  const left = Math.max(0, cap - real);
  const pct = cap > 0 ? Math.min(100, Math.round((real / cap) * 100)) : 0;
  return { filled: real, ceiling: cap, left, pct };
}

// Precedence: ceiling (done quoting) > kill-switch > worker paused > watching.
export function quotingState({ active, kill, filled, ceiling } = {}) {
  const rem = remainingFill({ filled, ceiling });
  if (rem.ceiling > 0 && rem.left <= 0) {
    return { key: "ceiling", label: "deactivated at ceiling", quoting: false };
  }
  if (kill) return { key: "kill", label: "kill-switch", quoting: false };
  if (active === false) return { key: "paused", label: "worker paused", quoting: false };
  return { key: "watching", label: "watching", quoting: true };
}

export function tapeNoPrice(outcome) {
  if (!outcome) return null;
  const direct = toNum(outcome.tape_no_price);
  if (direct != null) return direct;
  const tape = outcome.raw && typeof outcome.raw === "object" ? outcome.raw.tape : null;
  if (!tape) return null;
  return toNum(tape.no_price != null ? tape.no_price : tape.noPrice);
}

export function tapeMatch(outcome) {
  if (!outcome) return null;
  if (outcome.tape_match) return outcome.tape_match;
  const tape = outcome.raw && typeof outcome.raw === "object" ? outcome.raw.tape : null;
  return (tape && (tape.match || null)) || null;
}

export function formatCents(price) {
  const n = toNum(price);
  if (n == null) return null;
  return `${Math.round(n * 100)}¢`;
}

const LOSS_LABEL = {
  outbid: "outbid",
  too_slow: "too slow",
  no_taker: "no taker",
  no_purchase: "no taker",
  unknown: "lost",
};

export function formatLoss(outcome) {
  if (!outcome) return null;
  const price = formatCents(tapeNoPrice(outcome));
  const matched = tapeMatch(outcome) === "matched";
  const reason = outcome.loss_reason || "lost";
  // Watcher retags tape-matched losses as outbid; no_purchase + a stored
  // clearing price is the same signal (inferred from the public combo tape).
  if (price && (matched || reason === "outbid" || reason === "no_purchase")) {
    return `outbid at ${price}`;
  }
  return LOSS_LABEL[reason] || reason;
}

export function skipLabel(row, { filled, ceiling, hedgeCap } = {}) {
  const contracts = toNum(row && row.contracts);
  const rem = remainingFill({ filled, ceiling });
  const perFill = toNum(hedgeCap);
  const tooBigForRemain = contracts != null && rem.left > 0 && contracts > rem.left;
  const tooBigForCeil = contracts != null && rem.ceiling > 0 && contracts > rem.ceiling;
  const tooBigForHedge = contracts != null && perFill != null && perFill > 0 && contracts > perFill;
  if (tooBigForRemain || tooBigForCeil || tooBigForHedge) {
    const need = rem.left > 0 ? rem.left : rem.ceiling;
    const size = Number.isInteger(contracts) ? String(contracts) : String(contracts);
    return {
      kind: "oversized",
      text: need > 0
        ? `skipped oversized ${size} (need ≤${need})`
        : `skipped oversized ${size} (cannot partial-fill)`,
    };
  }
  if (contracts != null) return { kind: "skipped", text: `skipped ${contracts}` };
  return { kind: "skipped", text: "skipped" };
}

export function lastSkip({ matches = [], outcomeByRfq = {}, filled, ceiling, hedgeCap } = {}) {
  const skips = (matches || []).filter((m) => m && m.rfq_id && !outcomeByRfq[m.rfq_id]);
  if (!skips.length) return null;
  const last = [...skips].sort((a, b) => tsMs(b.matched_at) - tsMs(a.matched_at))[0];
  const label = skipLabel(last, { filled, ceiling, hedgeCap });
  return {
    at: last.matched_at || null,
    rfqId: last.rfq_id,
    contracts: last.contracts,
    ...label,
  };
}

export function lastLoss(outcomes = []) {
  const lost = (outcomes || []).filter((o) => o && o.outcome === "lost");
  if (!lost.length) return null;
  const last = [...lost].sort((a, b) => tsMs(b.posted_at || b.updated_at) - tsMs(a.posted_at || a.updated_at))[0];
  return {
    at: last.posted_at || last.updated_at || null,
    rfqId: last.rfq_id,
    reason: last.loss_reason || "lost",
    text: formatLoss(last),
    clearingCents: formatCents(tapeNoPrice(last)),
    outcome: last,
  };
}

export function lastRelevant(skip, loss) {
  const skipT = skip ? tsMs(skip.at) : 0;
  const lossT = loss ? tsMs(loss.at) : 0;
  if (skip && loss) return skipT >= lossT ? { kind: "skip", ...skip } : { kind: "loss", ...loss };
  if (loss) return { kind: "loss", ...loss };
  if (skip) return { kind: "skip", ...skip };
  return null;
}

export function outcomesForParlay(outcomes, { parlayId, matches = [] } = {}) {
  const rfqs = new Set((matches || []).map((m) => m && m.rfq_id).filter(Boolean));
  return (outcomes || []).filter((o) => o && (o.parlay_id === parlayId || (o.rfq_id && rfqs.has(o.rfq_id))));
}

export function buildParlayDesk({
  parlay,
  filled = 0,
  quoted = 0,
  kill = false,
  matches = [],
  outcomes = [],
  outcomeByRfq = {},
} = {}) {
  const ceiling = parlay && parlay.max_contracts != null ? parlay.max_contracts : 0;
  const fill = remainingFill({ filled, ceiling });
  const quote = quotingState({ active: parlay && parlay.active, kill, filled, ceiling });
  const skip = lastSkip({ matches, outcomeByRfq, filled, ceiling, hedgeCap: ceiling });
  const parlayOutcomes = outcomesForParlay(outcomes, { parlayId: parlay && parlay.id, matches });
  const loss = lastLoss(parlayOutcomes);
  return {
    fill,
    quote,
    skip,
    loss,
    relevant: lastRelevant(skip, loss),
    quoted: toNum(quoted) || 0,
    awaiting: (toNum(quoted) || 0) > fill.filled,
  };
}
