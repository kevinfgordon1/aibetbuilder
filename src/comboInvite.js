// Combo Locks invite requests (signed-in users only; never shown logged out).
export const INVITE_TABLE = "combo_invite_requests";
export const INVITE_STATUSES = ["pending", "approved", "declined"];
export const INVITE_COPY = Object.freeze({
  title: "New: Combo Locks (invite only)",
  body: "Lock in profit on boosted parlays by hedging on Kalshi and Polymarket. Spots are limited.",
  risk: "21+ only. Results aren't guaranteed: prices move, hedges can fail to fill, and you can lose money. Bet responsibly.",
  cta: "Request an invite",
  done: "You're on the list. We'll let you know.",
});
export const dismissKey = (userId) => `abb.comboInvite.dismissed.${userId}`;

/** Show the banner only to signed-in users without Combo Locks who haven't dismissed it. */
export function shouldShowInviteBanner({ user, hasAccess, dismissed }) {
  return !!(user && user.id && !hasAccess && !dismissed);
}

export function cleanInviteInput({ email, books, notes }) {
  const t = (s, n) => { const v = String(s == null ? "" : s).trim().slice(0, n); return v || null; };
  return { email: t(email, 320), books: t(books, 500), notes: t(notes, 1000) };
}

export function statusUpdate(status, now = new Date()) {
  if (!INVITE_STATUSES.includes(status)) throw new Error("bad status");
  return { status, decided_at: status === "pending" ? null : now.toISOString() };
}

export async function fetchMyInvite(supabase, userId) {
  const { data, error } = await supabase.from(INVITE_TABLE).select("id,status,created_at").eq("user_id", userId).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

export async function submitInvite(supabase, userId, input) {
  const c = cleanInviteInput(input);
  if (!c.email) throw new Error("Email is required.");
  const { error } = await supabase.from(INVITE_TABLE).insert({ user_id: userId, ...c });
  if (error && error.code !== "23505") throw error; // 23505 = already requested
  return true;
}
