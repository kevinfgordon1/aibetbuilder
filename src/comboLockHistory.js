// Per-lock Combo Locks attempt history (Miss-tape classification, under the card).
// Every attempt shows — not fills only: armed, quoted/rested, skipped, cancelled,
// expired, unfilled, filled (partial or full). Reuses comboTape.buildLockTape.

import { buildLockTape, formatSkipReason } from "./comboTape.js";

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

export function visibleAttempts(events, cap = ATTEMPT_CAP) {
  const list = events || [];
  const head = list.filter((e) => e.key === "armed" || e.key === "created");
  const rest = list.filter((e) => e.key !== "armed" && e.key !== "created");
  const shownRest = rest.slice(0, Math.max(0, cap - head.length));
  return { shown: [...head, ...shownRest], extra: Math.max(0, rest.length - shownRest.length) };
}
