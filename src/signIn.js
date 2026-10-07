// Passwordless email and extra OAuth providers on top of Google.
//
// Return visits keep the in-app hash (#promo/..., #ev, #new-odds-board).
// Supabase's implicit grant writes tokens into the URL fragment, which would
// wipe that hash, so the hash is carried in the auth_next query param.
// GoTrue allows any path or query on the Site URL host, and matches extra
// redirect hosts against the allow list with the fragment removed.
//
// X is Supabase provider "x" (OAuth 2.0). Legacy "twitter" is OAuth 1.0a.
// @supabase/supabase-js 2.117 (this install) includes "x" on the Provider union.

export const AUTH_NEXT_PARAM = "auth_next";

/** OAuth 2.0 provider id. Use "twitter" only on a supabase-js that lacks "x". */
export const X_OAUTH_PROVIDER = "x";

export const SIGN_IN_PROVIDERS = Object.freeze(["google", X_OAUTH_PROVIDER, "facebook"]);

const UNAVAILABLE = "Sign-in is temporarily unavailable. Please try again in a moment.";

export function normalizeSignInEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function isPlausibleEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

/** In-app hash only. Rejects auth callback fragments and off-site values. */
export function safeAppHash(hash) {
  const h = String(hash || "");
  if (!h.startsWith("#") || h.length < 2 || h.length > 2000) return "";
  if (h.startsWith("#//") || h.includes("\\") || h.includes("://") || /\s/.test(h)) return "";
  if (/access_token=|refresh_token=|provider_token=|error_description=/.test(h)) return "";
  if (/^#error(=|&|$)/.test(h)) return "";
  return h;
}

export function authNextHash(search) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  return safeAppHash(params.get(AUTH_NEXT_PARAM) || "");
}

/** Hash the app should boot from: a real route hash, else auth_next. */
export function bootAppHash(loc) {
  if (!loc) return "";
  return safeAppHash(loc.hash) || authNextHash(loc.search) || "";
}

export function buildAuthRedirectUrl(loc) {
  const origin = loc && loc.origin ? loc.origin : "http://localhost";
  const pathname = loc && loc.pathname ? loc.pathname : "/";
  const url = new URL(pathname, origin);
  const incoming = new URLSearchParams((loc && loc.search) || "");
  for (const key of ["code", "error", "error_code", "error_description", AUTH_NEXT_PARAM]) {
    incoming.delete(key);
  }
  for (const [key, value] of incoming.entries()) url.searchParams.append(key, value);
  const hash = safeAppHash(loc && loc.hash);
  if (hash) url.searchParams.set(AUTH_NEXT_PARAM, hash);
  return url.toString();
}

/** After Supabase consumes #access_token, put the visitor back on their route. */
export function restoreAuthReturnUrl(loc) {
  const next = authNextHash(loc && loc.search);
  if (!next) return "";
  const current = safeAppHash(loc && loc.hash);
  const origin = loc && loc.origin ? loc.origin : "http://localhost";
  const pathname = loc && loc.pathname ? loc.pathname : "/";
  const url = new URL(pathname, origin);
  const incoming = new URLSearchParams((loc && loc.search) || "");
  for (const key of [AUTH_NEXT_PARAM, "code", "error", "error_code", "error_description"]) {
    incoming.delete(key);
  }
  for (const [key, value] of incoming.entries()) url.searchParams.append(key, value);
  return url.pathname + url.search + (current || next);
}

export function describeAuthError(error) {
  const message = String((error && (error.message || error.error_description || error.msg)) || "").trim();
  const code = String((error && (error.code || error.error_code || error.error)) || "").toLowerCase();
  const status = Number(error && error.status);
  const blob = (code + " " + message).toLowerCase();
  if (
    status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    blob.includes("rate limit") ||
    blob.includes("only request this after")
  ) {
    return {
      kind: "rate_limit",
      message: "Too many sign-in emails were just sent. Wait a minute, then try again.",
    };
  }
  if (
    blob.includes("provider is not enabled") ||
    blob.includes("unsupported provider") ||
    blob.includes("provider is not allowed")
  ) {
    return {
      kind: "error",
      message: "That sign-in option isn’t turned on yet. Use another option, or try again after it’s enabled.",
    };
  }
  if (blob.includes("email address not authorized") || blob.includes("signup is disabled")) {
    return {
      kind: "error",
      message: "We couldn’t email that address from the default mailer. Try Google, or use an address that’s allowed to receive sign-in mail.",
    };
  }
  if ((blob.includes("invalid") && blob.includes("email")) || blob.includes("unable to validate email")) {
    return { kind: "error", message: "Enter a valid email address." };
  }
  return { kind: "error", message: "Sign-in didn’t go through. Please try again." };
}

export function authCallbackError(loc) {
  if (!loc) return null;
  const hashParams = new URLSearchParams(String(loc.hash || "").replace(/^#/, ""));
  const searchParams = new URLSearchParams(String(loc.search || "").replace(/^\?/, ""));
  const raw = hashParams.get("error_description") || searchParams.get("error_description") || "";
  const code = hashParams.get("error_code") || searchParams.get("error_code") || hashParams.get("error") || searchParams.get("error") || "";
  if (!raw && !code) return null;
  let message = raw;
  try {
    message = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch (_) { /* keep raw */ }
  return describeAuthError({ message, code, error: code, status: /429|rate/.test(String(code)) ? 429 : undefined });
}

function missingClient() {
  return { ok: false, kind: "error", message: UNAVAILABLE };
}

export async function startOAuthSignIn(client, provider, loc) {
  if (!client || !client.auth || typeof client.auth.signInWithOAuth !== "function") return missingClient();
  const redirectTo = buildAuthRedirectUrl(loc);
  const options = { redirectTo };
  if (provider === "facebook") options.scopes = "email,public_profile";
  try {
    const { data, error } = await client.auth.signInWithOAuth({ provider, options });
    if (error) return { ok: false, ...describeAuthError(error) };
    return { ok: true, url: data && data.url ? data.url : "" };
  } catch (err) {
    return { ok: false, ...describeAuthError(err) };
  }
}

export async function sendMagicLink(client, emailRaw, loc) {
  const email = normalizeSignInEmail(emailRaw);
  if (!isPlausibleEmail(email)) {
    return { ok: false, kind: "error", message: "Enter a valid email address." };
  }
  if (!client || !client.auth || typeof client.auth.signInWithOtp !== "function") return missingClient();
  try {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: buildAuthRedirectUrl(loc),
        shouldCreateUser: true,
      },
    });
    if (error) return { ok: false, ...describeAuthError(error) };
    return {
      ok: true,
      kind: "sent",
      email,
      message: "Check your email",
    };
  } catch (err) {
    return { ok: false, ...describeAuthError(err) };
  }
}
