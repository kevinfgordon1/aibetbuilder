// Owner-only in-app alerts (public.app_alerts). Written by combo-worker
// (service role); Kevin reads them and marks them read from the app.
// Visible to OWNER_EMAIL only (canSeeOwnerTools) in the UI, and RLS on the
// table enforces the same on the server. Never Telegram.

import { canSeeOwnerTools } from "./comboAccess.js";

export const APP_ALERTS_TABLE = "app_alerts";
export const APP_ALERTS_POLL_MS = 60_000;
export const APP_ALERTS_LIMIT = 50;

export function canSeeAppAlerts(user) {
  return canSeeOwnerTools(user);
}

const SEVERITIES = new Set(["info", "warn", "error"]);

export function normalizeAppAlert(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const title = String(raw.title || "").trim();
  if (!id || !title) return null;
  const severity = SEVERITIES.has(raw.severity) ? raw.severity : "info";
  return {
    id,
    kind: String(raw.kind || ""),
    severity,
    title,
    body: String(raw.body || ""),
    createdAt: raw.created_at || raw.createdAt || null,
    readAt: raw.read_at || raw.readAt || null,
    resolvedAt: raw.resolved_at || raw.resolvedAt || null,
  };
}

// Kinds that routinely heal themselves. Once the worker marks one resolved the
// banner (and bell badge) stop showing it; it stays in the bell history list.
// Repeat / unrecovered stalls use a different kind (poly_ws_stall_escalated),
// which keeps its warning banner until the worker resolves it.
export const SELF_HEALING_KINDS = new Set(["poly_ws_stall"]);

export function isSelfHealedAlert(a) {
  return !!(a && SELF_HEALING_KINDS.has(a.kind) && a.resolvedAt);
}

// Alerts that deserve the banner / badge (everything except healed ones).
export function bannerAlerts(list) {
  return (Array.isArray(list) ? list : []).filter((a) => !isSelfHealedAlert(a));
}

// Newest first; unread only; severity does not reorder (recency wins).
export function unreadAppAlerts(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeAppAlert)
    .filter((a) => a && !a.readAt)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function alertAgeLabel(createdAt, now = Date.now()) {
  const t = Date.parse(createdAt || "");
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function bellLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n > 9 ? "9+" : String(n);
}

// Never throws. Returns [] on any failure so the page is unaffected.
export async function fetchUnreadAppAlerts(supabase, user) {
  if (!canSeeAppAlerts(user) || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from(APP_ALERTS_TABLE)
      .select("id,kind,severity,title,body,created_at,read_at,resolved_at")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(APP_ALERTS_LIMIT);
    if (error) return [];
    return unreadAppAlerts(data);
  } catch (_) {
    return [];
  }
}

// ids: array of alert ids. Returns true when the update succeeded.
export async function markAppAlertsRead(supabase, user, ids) {
  const list = [].concat(ids || []).filter(Boolean);
  if (!canSeeAppAlerts(user) || !supabase || !list.length) return false;
  try {
    const { error } = await supabase
      .from(APP_ALERTS_TABLE)
      .update({ read_at: new Date().toISOString() })
      .in("id", list);
    return !error;
  } catch (_) {
    return false;
  }
}
