// Combo Locks per-lock History / Matched RFQ fetch.
//
// combo-worker writes every SKIP (game_started, no_lock_overlap, …) onto
// combo_submissions. A newest-first .limit(80) on one lock then returns only
// later declines and drops midday Polymarket/Kalshi quotes that still have
// quote_id. Fetch quotes/fills and noisy skips on separate caps, then merge.

export const LOCK_QUOTE_LIMIT = 400;
export const LOCK_SKIP_LIMIT = 40;
export const LOCK_ARCHIVED_QUOTE_LIMIT = 400;
export const LOCK_ARCHIVED_SKIP_LIMIT = 80;

// Posted quotes persist as unfilled (worker maps quoted → unfilled) + quote_id.
export const LOCK_QUOTE_OR =
  "quote_id.not.is.null,order_id.not.is.null,status.in.(filled,unfilled,quoted)";

// game_started / no_lock_overlap* flood the tape after first pitch.
export const LOCK_SKIP_OR =
  "skip_reason.is.null,and(skip_reason.neq.game_started,skip_reason.not.like.no_lock_overlap*)";

export const NOISY_SKIP_REASONS = Object.freeze(["game_started"]);

export function isNoisySkipReason(reason) {
  if (reason == null || reason === "") return false;
  const s = String(reason).toLowerCase();
  if (s === "game_started") return true;
  return s === "no_lock_overlap" || s.startsWith("no_lock_overlap:");
}

export function isLockQuoteRow(row) {
  if (!row) return false;
  if (row.quote_id || row.order_id) return true;
  const st = String(row.status || "").toLowerCase();
  return st === "filled" || st === "unfilled" || st === "quoted";
}

export function mergeSubmissionRows(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      if (!row || row.id == null) continue;
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const tb = Date.parse(b.created_at || "") || 0;
    const ta = Date.parse(a.created_at || "") || 0;
    return tb - ta;
  });
}

function applyQuoteFilters(q, { userId, parlayId, parlayIds, limit }) {
  let next = q.select("*").eq("user_id", userId).neq("status", "shadow");
  if (parlayId) next = next.eq("parlay_id", parlayId);
  if (parlayIds && parlayIds.length) next = next.in("parlay_id", parlayIds);
  return next.or(LOCK_QUOTE_OR).order("created_at", { ascending: false }).limit(limit);
}

function applySkipFilters(q, { userId, parlayId, parlayIds, limit }) {
  let next = q.select("*").eq("user_id", userId).eq("status", "declined").is("quote_id", null);
  if (parlayId) next = next.eq("parlay_id", parlayId);
  if (parlayIds && parlayIds.length) next = next.in("parlay_id", parlayIds);
  return next.or(LOCK_SKIP_OR).order("created_at", { ascending: false }).limit(limit);
}

export function livingLockSubmissionQueries(client, { userId, parlayId }) {
  const table = () => client.from("combo_submissions");
  return [
    applyQuoteFilters(table(), { userId, parlayId, limit: LOCK_QUOTE_LIMIT }),
    applySkipFilters(table(), { userId, parlayId, limit: LOCK_SKIP_LIMIT }),
  ];
}

export function archivedLockSubmissionQueries(client, { userId, parlayIds }) {
  if (!parlayIds || !parlayIds.length) return [];
  const table = () => client.from("combo_submissions");
  return [
    applyQuoteFilters(table(), { userId, parlayIds, limit: LOCK_ARCHIVED_QUOTE_LIMIT }),
    applySkipFilters(table(), { userId, parlayIds, limit: LOCK_ARCHIVED_SKIP_LIMIT }),
  ];
}

export function lockSubmissionQueriesForParlays(client, { userId, living = [], archivedIds = [] }) {
  const reqs = [];
  for (const row of living) {
    if (!row || !row.id) continue;
    reqs.push(...livingLockSubmissionQueries(client, { userId, parlayId: row.id }));
  }
  reqs.push(...archivedLockSubmissionQueries(client, { userId, parlayIds: archivedIds }));
  return reqs;
}
