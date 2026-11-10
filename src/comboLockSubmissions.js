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
// Archived locks are finished, so their per-lock history is re-read at most this often
// (or when a lock moves to History). Each lock is its own equality read (see below).
export const ARCHIVED_SUBS_TTL_MS = 10 * 60 * 1000;
// Desk (locks, fills, booked contracts) stays on this cadence so the hedged bar moves.
// Quote/skip history for a lock that is still quoting (game not started, or a live quote)
// refreshes on LIVING_SUBS_POLL_MS. A lock whose game has started and that has no live
// quote refreshes on IDLE_SUBS_POLL_MS. The 20s timer does not stack a second fetch
// while one is already running.
export const DESK_POLL_MS = 20 * 1000;
export const LIVING_SUBS_POLL_MS = 60 * 1000;
export const IDLE_SUBS_POLL_MS = 5 * 60 * 1000;
export const SUBMISSION_FETCH_CONCURRENCY = 6;

// Columns the lock tape, quote history, open-quote cancel, and settlement ticker read.
// select('*') was the History scan at ~2s and tens of millions of shared_blks_read.
export const LOCK_SUBMISSION_COLUMNS = [
  "id",
  "parlay_id",
  "rfq_id",
  "status",
  "is_live",
  "quote_id",
  "order_id",
  "contracts",
  "venue",
  "skip_reason",
  "fill_american",
  "market_ticker",
  "remaining",
  "worst_lock",
  "cancel_requested_at",
  "created_at",
  "tape_match",
  "tape_no_price",
  "tape_yes_price",
].join(",");

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

// One lock per query: parlay_id = $id (not parlay_id = ANY(chunk)).
// pg_stat_statements on the 3.3M-row table: the ANY() History read (select *,
// order by created_at desc limit 400/80) averaged ~2.1s and ~1,300 heap blocks
// per call because combo_submissions_parlay_quote_idx / _skip_idx are
// (parlay_id, created_at desc) and a 100-id chunk sorts every match before LIMIT.
// The same filters with parlay_id equality stop at LIMIT on those indexes (~9ms).
// user_id stays on the equality read; that is the fast plan already in prod.
function applyQuoteFilters(q, { userId, parlayId, limit }) {
  return q.select(LOCK_SUBMISSION_COLUMNS)
    .eq("user_id", userId)
    .eq("parlay_id", parlayId)
    .neq("status", "shadow")
    .or(LOCK_QUOTE_OR)
    .order("created_at", { ascending: false })
    .limit(limit);
}

function applySkipFilters(q, { userId, parlayId, limit }) {
  return q.select(LOCK_SUBMISSION_COLUMNS)
    .eq("user_id", userId)
    .eq("parlay_id", parlayId)
    .eq("status", "declined")
    .is("quote_id", null)
    .or(LOCK_SKIP_OR)
    .order("created_at", { ascending: false })
    .limit(limit);
}

export function livingLockSubmissionQueries(client, { userId, parlayId, quoteLimit = LOCK_QUOTE_LIMIT, skipLimit = LOCK_SKIP_LIMIT }) {
  const table = () => client.from("combo_submissions");
  return [
    applyQuoteFilters(table(), { userId, parlayId, limit: quoteLimit }),
    applySkipFilters(table(), { userId, parlayId, limit: skipLimit }),
  ];
}

export function archivedLockSubmissionQueries(client, { userId, parlayIds }) {
  if (!parlayIds || !parlayIds.length) return [];
  const reqs = [];
  for (const parlayId of parlayIds) {
    if (!parlayId) continue;
    reqs.push(...livingLockSubmissionQueries(client, {
      userId,
      parlayId,
      quoteLimit: LOCK_ARCHIVED_QUOTE_LIMIT,
      skipLimit: LOCK_ARCHIVED_SKIP_LIMIT,
    }));
  }
  return reqs;
}

export function lockSubmissionQueriesForParlays(client, { userId, living = [], archivedIds = [] }) {
  const reqs = [];
  for (const row of living) {
    if (!row || !row.id) continue;
    reqs.push(...livingLockSubmissionQueries(client, { userId, parlayId: row.id }));
  }
  const ids = (archivedIds || []).filter(Boolean);
  if (ids.length) reqs.push(...archivedLockSubmissionQueries(client, { userId, parlayIds: ids }));
  return reqs;
}

// A lock still being quoted: worker is watching and the game has not started,
// or a quote is still live. Everything else (paused, game started, no live quote)
// only needs a slow refresh so a late fill still shows up.
export function lockQuotesLive(parlay, { live = false, now = Date.now() } = {}) {
  if (live) return true;
  if (!parlay || parlay.active === false || parlay.archived_at) return false;
  const start = Date.parse(parlay.starts_at || "");
  if (Number.isFinite(start) && start <= now) return false;
  return true;
}

export function lockSubmissionPollMs(parlay, opts = {}) {
  const quotingMs = opts.quotingMs || LIVING_SUBS_POLL_MS;
  const idleMs = opts.idleMs || IDLE_SUBS_POLL_MS;
  return lockQuotesLive(parlay, opts) ? quotingMs : idleMs;
}

export function submissionPollDue({ lastAt = 0, now = Date.now(), force = false, intervalMs = LIVING_SUBS_POLL_MS } = {}) {
  if (force) return true;
  if (!lastAt) return true;
  return now - lastAt >= intervalMs;
}

// Living locks whose quote/skip history should be read on this poll.
// alsoIds: parlays whose confirmed-fill set just changed (same poll as the fill bar).
export function livingLocksDue(rows, { now = Date.now(), force = false, lastAt, liveIds, alsoIds, quotingMs, idleMs } = {}) {
  const at = lastAt || new Map();
  const live = liveIds || new Set();
  const also = alsoIds || new Set();
  const due = [];
  for (const row of rows || []) {
    if (!row || !row.id) continue;
    const intervalMs = lockSubmissionPollMs(row, { live: live.has(row.id), now, quotingMs, idleMs });
    if (force || also.has(row.id) || submissionPollDue({ lastAt: at.get(row.id) || 0, now, intervalMs })) due.push(row);
  }
  return due;
}

// Await thenables a few at a time, in input order. Building every PostgREST
// filter chain up front does not send; the request starts when the builder is awaited.
export async function settleInBatches(tasks, concurrency = SUBMISSION_FETCH_CONCURRENCY) {
  const list = tasks || [];
  const results = new Array(list.length);
  if (!list.length) return results;
  let cursor = 0;
  const workers = Math.max(1, Math.min(concurrency, list.length));
  async function run() {
    while (cursor < list.length) {
      const i = cursor;
      cursor += 1;
      try {
        results[i] = { status: "fulfilled", value: await list[i] };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

// Locks whose quote read came back full (more rows exist than were loaded).
export function cappedLockIds(rows, limit = LOCK_QUOTE_LIMIT) {
  const n = new Map();
  for (const r of rows || []) {
    if (!r || !r.parlay_id || !isLockQuoteRow(r)) continue;
    n.set(r.parlay_id, (n.get(r.parlay_id) || 0) + 1);
  }
  return [...n.entries()].filter(([, c]) => c >= limit).map(([id]) => id);
}

// Card count: shown rows plus the not-filled quote rows that were not loaded.
export function notFilledTotal({ shown, loadedUnfilledQuotes, countedUnfilledQuotes }) {
  const s = Number(shown) || 0;
  const c = Number(countedUnfilledQuotes);
  const l = Number(loadedUnfilledQuotes) || 0;
  if (!Number.isFinite(c) || c <= l) return s;
  return s + (c - l);
}

// Yellow pill on each Combo Locks card ("25 quotes · 3 fills"), same chip as Miss tape.
// Reuses rows the page already loaded (no extra query). quotes = quotes we posted for
// the lock (filled + not filled); fills = fills that went through (Matched RFQs count).
// Locks over the 400-row window show a "+" on the loaded count. An exact count of
// the rest walked every quote row for that lock (~270ms, multi-second when the
// desk fired many at once). Zero quotes → "" (no pill).
export function lockQuoteFillCounts(rows, { fills = 0, countedUnfilledQuotes } = {}) {
  let quoted = 0;
  let unfilledLoaded = 0;
  for (const r of rows || []) {
    if (!isLockQuoteRow(r)) continue;
    const st = String(r.status || "").toLowerCase();
    if (st === "shadow") continue;
    quoted += 1;
    if (st !== "filled") unfilledLoaded += 1;
  }
  const c = Number(countedUnfilledQuotes);
  if (countedUnfilledQuotes != null && Number.isFinite(c) && c > unfilledLoaded) quoted += c - unfilledLoaded;
  const f = Math.max(0, Number(fills) || 0);
  quoted = Math.max(quoted, f);
  return { quoted, fills: f };
}

export function lockQuoteFillLine(rows, opts = {}) {
  const { quoted, fills: f } = lockQuoteFillCounts(rows, opts);
  if (!quoted) return "";
  const n = (x) => x.toLocaleString("en-US");
  const plus = opts.capped ? "+" : "";
  return `${n(quoted)}${plus} quote${quoted === 1 ? "" : "s"} · ${n(f)} fill${f === 1 ? "" : "s"}`;
}
