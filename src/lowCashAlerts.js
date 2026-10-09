// Per-user low-cash alerts for Combo Locks (public.combo_user_alerts).
// combo-worker writes a row when one of the user's quotes/orders is rejected
// for insufficient balance (Kalshi insufficient_balance, Polymarket
// insufficient funds/collateral) and resolves it once their cash covers it.
// Users see their own; the owner also sees testers' under "All users" (RLS).

export const USER_ALERTS_TABLE = "combo_user_alerts";
export const USER_ALERTS_POLL_MS = 60_000;
const COLS = "id,user_id,kind,venue,parlay_id,lock_label,need_usd,available_usd,shortfall_usd,skipped_count,created_at,read_at,resolved_at";

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function normalizeUserAlert(raw) {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  return {
    id: String(raw.id),
    userId: raw.user_id || null,
    kind: String(raw.kind || "low_cash"),
    venue: raw.venue === "polymarket" ? "polymarket" : "kalshi",
    parlayId: raw.parlay_id || null,
    lockLabel: raw.lock_label ? String(raw.lock_label) : "",
    needUsd: raw.need_usd != null ? Number(raw.need_usd) : null,
    availableUsd: raw.available_usd != null ? Number(raw.available_usd) : null,
    shortfallUsd: raw.shortfall_usd != null ? Number(raw.shortfall_usd) : null,
    skipped: Math.max(1, Number(raw.skipped_count) || 1),
    createdAt: raw.created_at || null,
    readAt: raw.read_at || null,
    resolvedAt: raw.resolved_at || null,
  };
}

/** Plain-language copy for one alert. */
export function lowCashText(a, { owner = false } = {}) {
  if (!a) return { title: "", body: "" };
  const short = money(a.shortfallUsd);
  const lock = a.lockLabel ? ` on ${a.lockLabel}` : "";
  // owner=true: Kevin reading someone else's alert in All users.
  const your = owner ? "their" : "your";
  const you = owner ? "They're" : "You're";
  if (a.venue === "polymarket") {
    return {
      title: "Some Combo Locks quotes were skipped: not enough Polymarket cash",
      body: `Some of ${your} Combo Locks quotes${lock} were skipped because ${your} Polymarket US buying power is too low.` +
        (short ? ` ${you} about ${short} short.` : "") +
        " Add money on Polymarket US to keep quoting.",
    };
  }
  return {
    title: "Some Combo Locks quotes were skipped: combos cash too low",
    body: `Some of ${your} Combo Locks quotes${lock} were skipped because ${your} combos cash is too low.` +
      (short ? ` ${you} about ${short} short.` : "") +
      ` Add money on Kalshi or raise ${your} Amount to keep for combos.`,
  };
}

/** Open (unresolved) alerts, newest first, one per lock. */
export function openUserAlerts(rows, { includeRead = false } = {}) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeUserAlert)
    .filter((a) => a && !a.resolvedAt && (includeRead || !a.readAt))
    .sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")))
    .filter((a) => {
      const k = `${a.userId}|${a.venue}|${a.parlayId || ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Owner view: open alerts grouped by user id. */
export function openAlertsByUser(rows) {
  const out = {};
  for (const a of openUserAlerts(rows, { includeRead: true })) (out[a.userId] ||= []).push(a);
  return out;
}

// Never throws. userId=null reads every row RLS allows (owner).
export async function fetchOpenUserAlerts(supabase, userId) {
  if (!supabase) return [];
  try {
    let q = supabase.from(USER_ALERTS_TABLE).select(COLS).is("resolved_at", null);
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
    return error ? [] : (data || []);
  } catch (_) {
    return [];
  }
}

export async function dismissUserAlerts(supabase, ids) {
  const list = [].concat(ids || []).filter(Boolean);
  if (!supabase || !list.length) return false;
  try {
    const { error } = await supabase.from(USER_ALERTS_TABLE).update({ read_at: new Date().toISOString() }).in("id", list);
    return !error;
  } catch (_) {
    return false;
  }
}
