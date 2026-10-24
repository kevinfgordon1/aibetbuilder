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
export const ARCHIVED_ID_CHUNK = 100;
// Archived locks are finished, so their per-lock history is re-read at most this often
// (or when a lock moves to History). These .in() reads were the slowest calls on the page.
export const ARCHIVED_SUBS_TTL_MS = 10 * 60 * 1000;

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

// History's .in(parlay_id, ids) reads skip the user_id filter: the ids are already this user's locks
// (every submission row carries its lock's user_id; RLS still applies), and with user_id in the
// query Postgres walks the user's whole 1M+ row (user_id, created_at) index instead of the
// per-lock partial indexes (combo_submissions_parlay_quote_idx / _skip_idx): ~5s → ~0.1s.
const scopeUser = (q, { userId, parlayIds }) => (parlayIds && parlayIds.length ? q : q.eq("user_id", userId));

function applyQuoteFilters(q, { userId, parlayId, parlayIds, limit }) {
  let next = scopeUser(q.select("*"), { userId, parlayIds }).neq("status", "shadow");
  if (parlayId) next = next.eq("parlay_id", parlayId);
  if (parlayIds && parlayIds.length) next = next.in("parlay_id", parlayIds);
  return next.or(LOCK_QUOTE_OR).order("created_at", { ascending: false }).limit(limit);
}

function applySkipFilters(q, { userId, parlayId, parlayIds, limit }) {
  let next = scopeUser(q.select("*"), { userId, parlayIds }).eq("status", "declined").is("quote_id", null);
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
  // Chunk archived ids so .in() URLs stay short now that History loads every lock.
  const ids = (archivedIds || []).filter(Boolean);
  for (let i = 0; i < ids.length; i += ARCHIVED_ID_CHUNK) {
    reqs.push(...archivedLockSubmissionQueries(client, { userId, parlayIds: ids.slice(i, i + ARCHIVED_ID_CHUNK) }));
  }
  return reqs;
}

// Real "Not filled" total for a lock whose quote read hit LOCK_QUOTE_LIMIT.
// head + count=exact (indexed on parlay_id, RLS applies): no rows come back.
export function lockUnfilledCountQuery(client, { userId, parlayId }) {
  return client.from("combo_submissions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("parlay_id", parlayId)
    .neq("status", "shadow").neq("status", "filled")
    .or(LOCK_QUOTE_OR);
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
// Locks over the 400-row window use the head count of not-filled quotes already fetched.
// Zero quotes → "" (no pill).
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
  return `${n(quoted)} quote${quoted === 1 ? "" : "s"} · ${n(f)} fill${f === 1 ? "" : "s"}`;
}
