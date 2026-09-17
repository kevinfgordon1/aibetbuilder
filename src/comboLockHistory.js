// Per-lock Combo Locks attempt history (Miss-tape classification, under the card).
// The card splits filled orders from the full tape. Every attempt still shows
// in All quotes: armed, quoted/rested, skipped, cancelled, expired, unfilled,
// filled (partial or full). Reuses comboTape.buildLockTape.

import { attemptLockLine, attemptLockParts, buildLockTape, formatSkipReason } from "./comboTape.js";

function tsMs(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

export function quotingEnded(parlay, now = Date.now()) {
  if (!parlay) return false;
  if (parlay.archived_at) return true;
  if (parlay.starts_at) {
    const t = Date.parse(parlay.starts_at);
    if (Number.isFinite(t) && now >= t) return true;
  }
  return false;
}

export function attemptFromTapeRow(row, { filled = 0, ceiling = 0 } = {}) {
  if (!row) return null;
  if (row.bucket === "filled") {
    const partial = ceiling > 0 && filled > 0 && filled < ceiling;
    return {
      key: "filled",
      label: partial ? "filled (partial)" : "filled",
      reason: partial ? "partial" : "full",
      at: row.at || null,
      contracts: row.contracts,
      venue: row.venue || null,
      venueKey: row.venueKey || null,
      row,
    };
  }
  if (row.bucket === "awaiting" || row.reason === "open") {
    return {
      key: "quoted",
      label: row.reason === "open" ? "quoted · rested" : "quoted · awaiting",
      reason: row.reason || "quoted",
      at: row.at || null,
      contracts: row.contracts,
      venue: row.venue || null,
      venueKey: row.venueKey || null,
      row,
    };
  }
  if (row.bucket === "oversized" || row.bucket === "skipped") {
    return {
      key: "skipped",
      label: formatSkipReason(row),
      reason: (row.skip && row.skip.kind) || row.reason || "skipped",
      at: row.at || null,
      contracts: row.contracts,
      venue: row.venue || null,
      venueKey: row.venueKey || null,
      row,
    };
  }
  if (row.reason === "cancelled") {
    return {
      key: "cancelled",
      label: "cancelled",
      reason: "cancelled",
      at: row.at || null,
      contracts: row.contracts,
      venue: row.venue || null,
      venueKey: row.venueKey || null,
      row,
    };
  }
  const why = row.reason === "quoted · no take" ? "unfilled · quoted, no take"
    : row.bucket === "outbid" ? "unfilled · outbid"
      : row.bucket === "too_slow" ? "unfilled · too slow"
        : row.bucket === "no_taker" ? "unfilled · no taker"
          : row.bucket === "lost" ? "unfilled · lost"
            : (row.reason || "unfilled");
  return {
    key: "unfilled",
    label: why,
    reason: row.reason || "unfilled",
    at: row.at || null,
    contracts: row.contracts,
    venue: row.venue || null,
    venueKey: row.venueKey || null,
    row,
  };
}

export function buildLockAttempts({
  parlay,
  fills = [],
  matches = [],
  outcomes = [],
  outcomeByRfq = {},
  submissions = [],
  now = Date.now(),
} = {}) {
  const tape = buildLockTape({
    parlay,
    fills,
    matches,
    outcomes,
    outcomeByRfq,
    submissions,
    now,
  });
  const filled = tape.fill ? tape.fill.filled : 0;
  const ceiling = tape.fill ? tape.fill.ceiling : 0;
  const events = [];
  if (parlay) {
    const armed = parlay.active === false && !parlay.archived_at ? "created · paused" : "armed";
    events.push({
      key: parlay.active === false && !parlay.archived_at ? "created" : "armed",
      label: armed,
      reason: parlay.active === false ? "paused" : "armed",
      at: parlay.created_at || null,
      contracts: null,
      venue: null,
      venueKey: null,
      row: null,
    });
  }
  const rows = [...(tape.rows || [])].sort((a, b) => tsMs(b.at) - tsMs(a.at));
  for (const row of rows) {
    const ev = attemptFromTapeRow(row, { filled, ceiling });
    if (ev) events.push(ev);
  }
  if (!rows.length && !(filled > 0)) {
    events.push({
      key: "unfilled",
      label: "unfilled · never matched",
      reason: "never_matched",
      at: null,
      contracts: null,
      venue: null,
      venueKey: null,
      row: null,
    });
  }
  if (quotingEnded(parlay, now) && !(filled > 0)) {
    const hasTerminal = events.some((e) => e.key === "expired" || e.reason === "never_matched");
    if (!hasTerminal || rows.length) {
      events.push({
        key: "expired",
        label: rows.length ? "expired · no fill" : "expired · never matched",
        reason: "expired",
        at: (parlay && (parlay.archived_at || parlay.starts_at)) || null,
        contracts: null,
        venue: null,
        venueKey: null,
        row: null,
      });
    }
  }
  const seen = new Set();
  const deduped = [];
  for (const ev of events) {
    const id = ev.key + "|" + (ev.at || "") + "|" + (ev.reason || "") + "|" + (ev.contracts ?? "");
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(ev);
  }
  const head = deduped.filter((e) => e.key === "armed" || e.key === "created");
  const tail = deduped.filter((e) => e.key !== "armed" && e.key !== "created")
    .sort((a, b) => tsMs(b.at) - tsMs(a.at));
  return {
    tape,
    filled,
    ceiling,
    events: [...head, ...tail],
  };
}

export const ATTEMPT_CAP = 60;

function attemptStats(attempts) {
  return attempts && attempts.tape && attempts.tape.live;
}

// Yellow Miss-tape skip + quoted-miss parts (Kalshi and Polymarket).
export function attemptSummaryParts(attempts) {
  return attemptLockParts(attemptStats(attempts));
}

export function attemptSummaryLine(attempts) {
  return attemptLockLine(attemptStats(attempts));
}

export function attemptSummaryFilled(attempts) {
  const stats = attemptStats(attempts);
  return !!(stats && stats.skippedFilled);
}

// Matched RFQs panel — fills only. History now splits the same way: a
// fills-only section, then the full attempt tape (quotes, skips, no-takes).
// Do not read combo_matches alone: quote-watcher may be parked, so filled
// submissions / combo_fills still list here.
export function isMatchedRfqFill(row) {
  return !!(row && row.bucket === "filled");
}

export function matchedRfqFillRows(attempts) {
  const rows = (attempts && attempts.tape && attempts.tape.rows) || [];
  return rows.filter(isMatchedRfqFill).sort((a, b) => tsMs(b.at) - tsMs(a.at));
}

export function matchedRfqCounts(attempts) {
  const rows = matchedRfqFillRows(attempts);
  let contracts = 0;
  for (const row of rows) {
    const n = Number(row && row.contracts);
    if (Number.isFinite(n) && n > 0) contracts += n;
  }
  return { filled: rows.length, contracts };
}

// Card chrome "matched N RFQs" still counts every live match. The open-card
// table uses matchedRfqCounts (fills only), not this.
export function matchedRfqMatchedCount(attempts) {
  const live = attemptStats(attempts);
  return (live && live.matched) || 0;
}

export function matchedRfqHeading(attempts) {
  const { filled, contracts } = matchedRfqCounts(attempts);
  const bits = [`Matched RFQs — fills only · ${filled} filled`];
  if (filled > 0 && contracts > 0) bits.push(`${contracts} contract${contracts === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

export function matchedRfqEmptyText(attempts) {
  const { filled } = matchedRfqCounts(attempts);
  if (filled > 0) return null;
  if (attempts && attempts.filled > 0) {
    return "No per-RFQ fill rows to list, but this lock has fills — see History and the fill bar.";
  }
  if (matchedRfqMatchedCount(attempts) > 0) {
    return "No fills yet. Every quote and skip is in History.";
  }
  return "No fills yet.";
}

// History card: same split as Matched RFQs vs the full tape — a fills-only
// list, then every attempt (quotes, skips, no-takes, and fills).
export function filledAttemptEvents(attempts) {
  return ((attempts && attempts.events) || []).filter((e) => e && e.key === "filled");
}

export function historyFillsHeading(attempts) {
  const { filled, contracts } = matchedRfqCounts(attempts);
  const bits = [`Filled orders — fills only · ${filled} filled`];
  if (filled > 0 && contracts > 0) bits.push(`${contracts} contract${contracts === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

export function historyQuotesHeading() {
  return "All quotes — every attempt";
}

export function historyFillsEmptyText(attempts) {
  if (filledAttemptEvents(attempts).length > 0) return null;
  if (attempts && attempts.filled > 0) {
    return "No per-RFQ fill rows to list, but this lock has fills — see the fill bar.";
  }
  return "No fills yet.";
}

export function matchedRfqWatcherParked(matches, attempts) {
  const { filled } = matchedRfqCounts(attempts);
  return filled > 0 && !(matches && matches.length);
}

// Consecutive identical attempts (status / reason / size / venue). Armed /
// created stay single so the first row is never folded into a later one.
export function collapseIdentity(ev) {
  if (!ev || ev.key === "armed" || ev.key === "created") return null;
  const venue = ev.venueKey || ev.venue || "";
  return [ev.key, ev.reason || "", ev.label || "", ev.contracts ?? "", venue].join("\0");
}

export function collapseAttempts(events) {
  const out = [];
  for (const ev of events || []) {
    const id = collapseIdentity(ev);
    const prev = out.length ? out[out.length - 1] : null;
    if (id && prev && collapseIdentity(prev) === id) {
      prev.count = (prev.count || 1) + 1;
      const times = [prev.at, prev.fromAt, ev.at].filter(Boolean);
      if (times.length) {
        const newest = times.reduce((a, b) => (tsMs(a) >= tsMs(b) ? a : b));
        const oldest = times.reduce((a, b) => (tsMs(a) <= tsMs(b) ? a : b));
        prev.at = newest;
        if (oldest !== newest) prev.fromAt = oldest;
      }
      continue;
    }
    out.push({ ...ev, count: 1 });
  }
  return out;
}

export function attemptRepeatLabel(ev) {
  if (!ev || !(ev.count > 1)) return "";
  const last = ev.at ? new Date(ev.at).toLocaleTimeString() : "";
  return last ? `×${ev.count} · last ${last}` : `×${ev.count}`;
}

export function visibleAttempts(events, cap = ATTEMPT_CAP) {
  const list = collapseAttempts(events || []);
  const head = list.filter((e) => e.key === "armed" || e.key === "created");
  const rest = list.filter((e) => e.key !== "armed" && e.key !== "created");
  const shownRest = rest.slice(0, Math.max(0, cap - head.length));
  return { shown: [...head, ...shownRest], extra: Math.max(0, rest.length - shownRest.length) };
}
