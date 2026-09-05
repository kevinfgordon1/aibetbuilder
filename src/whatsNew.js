// What’s New is owner-published in Supabase (whats_new_announcements).
// There is no hard-coded blast. Until Kevin publishes an enabled row,
// shouldShowWhatsNew is false for everyone. Bump happens automatically:
// each Publish writes a new id so anyone who dismissed the previous one sees it again.

export const WHATS_NEW_TABLE = "whats_new_announcements";

export function sanitizeCtaHref(href) {
  const s = String(href == null ? "" : href).trim();
  if (!s) return "";
  if (s.startsWith("#") || s.startsWith("/")) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return s;
  } catch {
    return "";
  }
  return "";
}

export function newAnnouncementId(now = new Date()) {
  const ts = now instanceof Date ? now.toISOString() : String(now);
  const rand = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
}

export function normalizeAnnouncement(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  if (!id) return null;
  const title = String(raw.title || "").trim();
  const body = String(raw.body || "").trim();
  const enabled = raw.enabled !== false && raw.enabled !== "false";
  const ctaLabel = String(
    raw.cta_label ?? raw.ctaLabel ?? (raw.cta && raw.cta.label) ?? "",
  ).trim();
  const ctaHref = sanitizeCtaHref(
    raw.cta_href ?? raw.ctaHref ?? (raw.cta && raw.cta.href) ?? "",
  );
  return {
    id,
    title,
    body,
    enabled,
    cta: ctaLabel && ctaHref ? { label: ctaLabel, href: ctaHref } : null,
    publishedAt: raw.published_at || raw.publishedAt || null,
  };
}

export function isPublishedAnnouncement(announcement) {
  const n = announcement && announcement.title !== undefined
    ? announcement
    : normalizeAnnouncement(announcement);
  if (!n || !n.id || n.enabled === false) return false;
  if (!String(n.title || "").trim() || !String(n.body || "").trim()) return false;
  return true;
}

export function shouldShowWhatsNew(announcement, prefs, { sessionDismissed } = {}) {
  if (!isPublishedAnnouncement(announcement)) return false;
  if (sessionDismissed) return false;
  const seen = prefs && typeof prefs.seenAnnouncementId === "string"
    ? prefs.seenAnnouncementId.trim()
    : "";
  return seen !== String(announcement.id);
}

export function announcementRowFromDraft(draft, { now, id } = {}) {
  const publishedAt = now instanceof Date
    ? now.toISOString()
    : (now || new Date().toISOString());
  const title = String(draft && draft.title || "").trim();
  const body = String(draft && draft.body || "").trim();
  const ctaLabel = String(draft && (draft.ctaLabel ?? draft.cta_label) || "").trim();
  const ctaHref = sanitizeCtaHref(draft && (draft.ctaHref ?? draft.cta_href) || "");
  return {
    id: String(id || newAnnouncementId(typeof now === "string" ? new Date(now) : (now || new Date()))),
    title,
    body,
    cta_label: ctaLabel || null,
    cta_href: ctaHref || null,
    enabled: true,
    published_at: publishedAt,
  };
}

async function selectLatest(client, { includeDisabled = false } = {}) {
  if (!client || typeof client.from !== "function") return { data: null, error: new Error("no client") };
  let q = client
    .from(WHATS_NEW_TABLE)
    .select("id,title,body,cta_label,cta_href,enabled,published_at")
    .order("published_at", { ascending: false })
    .limit(1);
  if (!includeDisabled) q = q.eq("enabled", true);
  return q.maybeSingle();
}

export async function fetchActiveAnnouncement(client) {
  try {
    const { data, error } = await selectLatest(client, { includeDisabled: false });
    if (error || !data) return null;
    const n = normalizeAnnouncement(data);
    return isPublishedAnnouncement(n) ? n : null;
  } catch {
    return null;
  }
}

export async function fetchLatestAnnouncement(client) {
  try {
    const { data, error } = await selectLatest(client, { includeDisabled: true });
    if (error || !data) return null;
    return normalizeAnnouncement(data);
  } catch {
    return null;
  }
}

export async function publishAnnouncement(client, draft, opts) {
  if (!client || typeof client.from !== "function") {
    return { ok: false, error: new Error("no client") };
  }
  const row = announcementRowFromDraft(draft, opts);
  if (!row.title || !row.body) {
    return { ok: false, error: new Error("Title and body are required.") };
  }
  try {
    const { error: disableError } = await client
      .from(WHATS_NEW_TABLE)
      .update({ enabled: false })
      .eq("enabled", true);
    if (disableError) return { ok: false, error: disableError };
    const { data, error } = await client
      .from(WHATS_NEW_TABLE)
      .insert(row)
      .select("id,title,body,cta_label,cta_href,enabled,published_at")
      .single();
    if (error) return { ok: false, error };
    return { ok: true, announcement: normalizeAnnouncement(data || row) };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function unpublishAnnouncement(client) {
  if (!client || typeof client.from !== "function") {
    return { ok: false, error: new Error("no client") };
  }
  try {
    const { error } = await client
      .from(WHATS_NEW_TABLE)
      .update({ enabled: false })
      .eq("enabled", true);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
