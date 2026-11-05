import { createClient } from "@supabase/supabase-js";

// One GoTrue client for the whole page. Each createClient starts its own
// auto-refresh against the same localStorage key. Supabase rotates the refresh
// token, so a second client's refresh is rejected (refresh_token_already_used)
// and that client can delete the session, which signs the user out.
// Server handlers keep their own clients (service role, persistSession: false).

let cached;
let factory = createClient;
let envOverride;

function browserEnv() {
  if (envOverride) return envOverride;
  const env = import.meta.env || {};
  return {
    url: env.VITE_SUPABASE_URL || "",
    key: env.VITE_SUPABASE_ANON_KEY || "",
  };
}

/** Build a client, or null when the public URL/key are missing or create throws. */
export function browserClientFromEnv(env, create = createClient) {
  const url = String((env && env.url) || "");
  const key = String((env && env.key) || "");
  if (!url || !key) return null;
  try {
    return create(url, key);
  } catch (err) {
    console.error("Supabase client failed to start", err);
    return null;
  }
}

/** The page's only browser Supabase client. Later calls return the same object. */
export function getBrowserSupabase() {
  if (cached !== undefined) return cached;
  cached = browserClientFromEnv(browserEnv(), factory);
  return cached;
}

/** Test hook. Production never calls this. */
export function resetBrowserSupabaseForTests({ env, create } = {}) {
  cached = undefined;
  envOverride = env || null;
  factory = create || createClient;
}

/**
 * User to show after an auth event. SIGNED_OUT is not a logout when storage
 * still holds a session: a refresh race can emit it after another writer
 * already saved a rotated token, or before this handler reads that write.
 * A real signOut leaves storage empty.
 */
export async function userAfterAuthEvent(client, event, session) {
  const fromEvent = session && session.user ? session.user : null;
  if (event !== "SIGNED_OUT") return fromEvent;
  if (!client || !client.auth || typeof client.auth.getSession !== "function") return null;
  try {
    const { data } = await client.auth.getSession();
    return (data && data.session && data.session.user) || null;
  } catch (_) {
    return null;
  }
}
