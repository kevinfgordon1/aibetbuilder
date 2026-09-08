// Combo Locks desk-strip mapping — pure helpers over data the page already polls
// (combo_parlays, combo_fills, combo_matches, quote_outcomes).
//
// Skips are matched RFQs the worker did not quote (especially oversized ones —
// Kalshi makers cannot partial-fill). combo_submissions.skip_reason (Poly
// combo-worker #57, Kalshi skip-tape) maps to a short label; unknown codes
// show raw. Losses and tape clearing prices come from quote-watcher
// (loss_reason + tape_no_price, or raw.tape fallback).

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

const SKIP_REASON_KEYS = ["skip_reason", "skipReason"];

// combo-worker persist codes (Kalshi classifySkip + Poly polySkipReason).
// Prefix `no_lock_overlap:` is the near-miss / noise family. ` xN` is the
// hourly aggregate count (no_shared_game / no_rfq_tokens). Funding skips
// use insufficient_balance (primary); accept close synonyms if written.
const SKIP_REASON_LABELS = {
  oversized: "oversized",
  rfq_too_large: "oversized",
  limit_reached: "cap reached",
  limitreached: "cap reached",
  insufficient_balance: "insufficient funds",
  insufficient_funds: "insufficient funds",
  insufficientbalance: "insufficient funds",
  insufficientfunds: "insufficient funds",
  underfunded: "insufficient funds",
  low_balance: "insufficient funds",
  game_started: "game started",
  started: "game started",
  no_lock_overlap: "no lock overlap",
  "no_lock_overlap:leg_count": "different leg count",
  "no_lock_overlap:same_games_no_match": "same games, no match",
  "no_lock_overlap:missing_team": "missing team",
  "no_lock_overlap:doubleheader": "doubleheader",
  "no_lock_overlap:no_shared_game": "no shared game",
  "no_lock_overlap:no_rfq_tokens": "no RFQ tokens",
  leg_count: "different leg count",
  same_games_no_match: "same games, no match",
  missing_team: "missing team",
  doubleheader: "doubleheader",
  no_shared_game: "no shared game",
  no_rfq_tokens: "no RFQ tokens",
};

export function skipReasonOf(row) {
  if (!row || typeof row !== "object") return null;
  const bags = [row, row.raw && typeof row.raw === "object" ? row.raw : null];
  for (const bag of bags) {
    if (!bag) continue;
    for (const k of SKIP_REASON_KEYS) {
      if (bag[k] == null || bag[k] === "") continue;
      const s = String(bag[k]).trim();
      if (s) return s;
    }
  }
  return null;
}

function normalizeSkipReasonKey(value) {
  return String(value || "").trim().toLowerCase().replace(/-/g, "_");
}

export function parseSkipReason(value) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return { raw: "", key: "", count: null };
  const counted = raw.match(/^(.*?)\s+[x×](\d+)\s*$/i);
  const base = counted ? counted[1].trim() : raw;
  const count = counted ? Number(counted[2]) : null;
  return { raw, key: normalizeSkipReasonKey(base), count: Number.isFinite(count) ? count : null };
}

export function formatStoredSkipReason(value) {
  const parsed = parseSkipReason(value);
  if (!parsed.key) return null;
  const suffix = parsed.key.startsWith("no_lock_overlap:")
    ? parsed.key.slice("no_lock_overlap:".length)
    : "";
  const mapped = SKIP_REASON_LABELS[parsed.key]
    || (suffix ? SKIP_REASON_LABELS[suffix] : null);
  if (!mapped) return parsed.raw;
  if (parsed.count != null && parsed.count > 1) return `${mapped} ×${parsed.count}`;
  return mapped;
}

function oversizedSkipText(contracts, rem) {
  const need = rem.left > 0 ? rem.left : rem.ceiling;
  const size = contracts != null
    ? (Number.isInteger(contracts) ? String(contracts) : String(contracts))
    : null;
  if (size && need > 0) return `skipped oversized ${size} (need ≤${need})`;
  if (size) return `skipped oversized ${size} (cannot partial-fill)`;
  return "skipped oversized";
}

export function skipLabel(row, { filled, ceiling, hedgeCap } = {}) {
  const stored = skipReasonOf(row);
  const parsed = parseSkipReason(stored);
  const oversizedStored = parsed.key === "oversized" || parsed.key === "rfq_too_large";
  const contracts = toNum(row && row.contracts);
  const rem = remainingFill({ filled, ceiling });
  const perFill = toNum(hedgeCap);
  const tooBigForRemain = contracts != null && rem.left > 0 && contracts > rem.left;
  const tooBigForCeil = contracts != null && rem.ceiling > 0 && contracts > rem.ceiling;
  const tooBigForHedge = contracts != null && perFill != null && perFill > 0 && contracts > perFill;
  // Stored skip_reason wins over the size heuristic so Poly game_started /
  // no_lock_overlap rows are not relabeled oversized just because the RFQ
  // is larger than remaining fill. Kalshi rows without a reason keep the
  // existing cannot-partial-fill copy.
  if (oversizedStored || (!stored && (tooBigForRemain || tooBigForCeil || tooBigForHedge))) {
    return { kind: "oversized", text: oversizedSkipText(contracts, rem), reason: stored || "oversized" };
  }
  if (stored) {
    const label = formatStoredSkipReason(stored);
    const text = label && /^skipped\b/i.test(label) ? label : `skipped · ${label || stored}`;
    return { kind: "skipped", text, reason: stored };
  }
  if (contracts != null) return { kind: "skipped", text: `skipped ${contracts}` };
  return { kind: "skipped", text: "skipped" };
}

export function lastSkip({ matches = [], submissions = [], outcomeByRfq = {}, filled, ceiling, hedgeCap } = {}) {
  const subByRfq = {};
  (submissions || []).forEach((s) => {
    if (s && s.rfq_id) subByRfq[s.rfq_id] = s;
  });
  const skips = (matches || []).filter((m) => m && m.rfq_id && !outcomeByRfq[m.rfq_id]);
  if (!skips.length) return null;
  const last = [...skips].sort((a, b) => tsMs(b.matched_at) - tsMs(a.matched_at))[0];
  const twin = subByRfq[last.rfq_id];
  const label = skipLabel({
    ...last,
    ...(twin || {}),
    skip_reason: skipReasonOf(twin) || skipReasonOf(last),
    contracts: last.contracts != null ? last.contracts : (twin && twin.contracts),
  }, { filled, ceiling, hedgeCap });
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
  if (skip && loss) return skipT >= lossT ? { ...skip, kind: "skip" } : { ...loss, kind: "loss" };
  if (loss) return { ...loss, kind: "loss" };
  if (skip) return { ...skip, kind: "skip" };
  return null;
}

export function outcomesForParlay(outcomes, { parlayId, matches = [] } = {}) {
  const rfqs = new Set((matches || []).map((m) => m && m.rfq_id).filter(Boolean));
  return (outcomes || []).filter((o) => o && (o.parlay_id === parlayId || (o.rfq_id && rfqs.has(o.rfq_id))));
}

// First settings+parlays fetch AND later 20s polls. Soft-fail (error or null
// data) must keep the last known desk — never treat a failed read as
// kill_switch=true or as an empty Active list.
export function comboSettledQuery(result) {
  if (result && result.status === "fulfilled") {
    const value = result.value || {};
    return { data: value.data, error: value.error || null };
  }
  const reason = result && result.reason;
  if (reason && typeof reason === "object") return { data: null, error: reason };
  return { data: null, error: { message: String(reason || "request failed") } };
}

export function comboListQueryOk(res) {
  return !!(res && !res.error && Array.isArray(res.data));
}

export function comboSettingsQueryOk(res) {
  return !!(res && !res.error);
}

export function applyComboDeskPoll({
  parlaysRes,
  settingsRes,
  prevParlays = [],
  prevKill = false,
  parlaysReady = false,
  settingsReady = false,
} = {}) {
  const parlaysOk = comboListQueryOk(parlaysRes);
  const settingsOk = comboSettingsQueryOk(settingsRes);
  const nextParlaysReady = parlaysReady === true || parlaysOk;
  const nextSettingsReady = settingsReady === true || settingsOk;
  const failed = !parlaysOk || !settingsOk;
  let errorNote = null;
  if (failed) {
    const bits = [];
    if (!parlaysOk) bits.push("locks");
    if (!settingsOk) bits.push("kill-switch");
    errorNote = (parlaysReady || settingsReady)
      ? `Couldn't refresh ${bits.join(" / ")} — showing last known desk.`
      : `Couldn't load ${bits.join(" / ")}. Retrying…`;
  }
  return {
    parlays: parlaysOk ? parlaysRes.data : (prevParlays || []),
    kill: settingsOk ? !!(settingsRes.data && settingsRes.data.kill_switch) : !!prevKill,
    applyParlays: parlaysOk,
    applyKill: settingsOk,
    parlaysReady: nextParlaysReady,
    settingsReady: nextSettingsReady,
    deskReady: nextParlaysReady && nextSettingsReady,
    failed,
    errorNote,
  };
}

export function comboDeskChrome({ deskLoading, deskReady, kill, deskError } = {}) {
  const ready = deskReady === true && deskLoading !== true;
  return {
    ready,
    showKillBanner: ready && !!kill,
    killSwitchOn: ready && !!kill,
    killSwitchDisabled: !ready,
    deskError: deskError || null,
  };
}

export function comboSectionKind({ deskLoading, deskReady, count } = {}) {
  if ((count || 0) > 0) return "rows";
  if (deskLoading || deskReady !== true) return "loading";
  return "empty";
}

export function buildParlayDesk({
  parlay,
  filled = 0,
  quoted = 0,
  kill = false,
  matches = [],
  submissions = [],
  outcomes = [],
  outcomeByRfq = {},
} = {}) {
  const ceiling = parlay && parlay.max_contracts != null ? parlay.max_contracts : 0;
  const fill = remainingFill({ filled, ceiling });
  const quote = quotingState({ active: parlay && parlay.active, kill, filled, ceiling });
  const skip = lastSkip({ matches, submissions, outcomeByRfq, filled, ceiling, hedgeCap: ceiling });
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
