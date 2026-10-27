// Native (Capacitor) push registration. No-op on the web.
export function isNativeApp(cap = (typeof window !== "undefined" ? window.Capacitor : null)) {
  return Boolean(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
}

export function pushTokenRow(userId, token, platform) {
  if (!userId || !token || (platform !== "ios" && platform !== "android")) return null;
  return { user_id: userId, token: String(token), platform, last_seen_at: new Date().toISOString(), disabled_at: null };
}

// Asks permission, registers with FCM/APNs and upserts the token for this user.
export async function registerPushForUser(supabase, user, deps = {}) {
  if (!user || !user.id || !supabase) return { ok: false, reason: "no-user" };
  const cap = deps.cap || (typeof window !== "undefined" ? window.Capacitor : null);
  if (!isNativeApp(cap)) return { ok: false, reason: "web" };
  const { PushNotifications } = deps.plugin ? { PushNotifications: deps.plugin } : await import("@capacitor/push-notifications");
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return { ok: false, reason: "denied" };
  const platform = cap.getPlatform();
  return new Promise((resolve) => {
    PushNotifications.addListener("registration", async ({ value }) => {
      const row = pushTokenRow(user.id, value, platform);
      if (!row) return resolve({ ok: false, reason: "bad-token" });
      const { error } = await supabase.from("push_tokens").upsert(row, { onConflict: "token" });
      resolve(error ? { ok: false, reason: error.message } : { ok: true });
    });
    PushNotifications.addListener("registrationError", (e) => resolve({ ok: false, reason: String((e && e.error) || "error") }));
    // Tapping a notification opens its deep link (#combo/<id>, #promo, ...).
    PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      const link = a && a.notification && a.notification.data && a.notification.data.link;
      if (link && typeof link === "string" && link.startsWith("#")) window.location.hash = link;
    });
    PushNotifications.register();
  });
}
