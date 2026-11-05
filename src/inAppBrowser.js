// In-app and embedded browsers (Facebook, Instagram, TikTok, X, Line, Gmail,
// Google app, Android WebView, iOS WKWebView). Google OAuth answers these
// with 403 disallowed_useragent. Real Safari, Chrome, Firefox, and Edge do not
// match.

const NAMED_IN_APP = [
  ["Facebook", /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i],
  ["Instagram", /\bInstagram\b/i],
  ["TikTok", /musical_ly|BytedanceWebview|\bTikTok\b|trill_|ByteLocale/i],
  ["X", /\bTwitter\b/i],
  ["Line", /\bLine\//i],
  ["Gmail", /\bGmail\b/i],
  ["Google app", /\bGSA\//i],
];

/** @returns {{ inApp: boolean, name: string }} */
export function detectInAppBrowser(ua) {
  const agent = String(ua || "");
  if (!agent) return { inApp: false, name: "" };
  for (const [name, re] of NAMED_IN_APP) {
    if (re.test(agent)) return { inApp: true, name };
  }
  // Android System WebView puts "; wv" in the UA. Chrome Custom Tabs do not.
  if (/;\s*wv[;)]/i.test(agent)) return { inApp: true, name: "WebView" };
  // iOS WKWebView: AppleWebKit without the Safari token full browsers include.
  if (
    /iPhone|iPad|iPod/i.test(agent) &&
    /AppleWebKit/i.test(agent) &&
    !/Safari\//i.test(agent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|SamsungBrowser/i.test(agent)
  ) {
    return { inApp: true, name: "WebView" };
  }
  return { inApp: false, name: "" };
}

export function inAppSignInNotice(detection) {
  const name = detection && detection.name;
  const where = name && name !== "WebView" ? `the ${name} browser` : "this browser";
  return `Google sign-in doesn’t work in ${where}. Open this page in Safari or Chrome, then sign in there.`;
}

/** Page URL to open elsewhere. Keeps the route hash and auth_next; drops auth errors. */
export function currentPageUrl(loc) {
  const origin = (loc && loc.origin) || "http://localhost";
  const pathname = (loc && loc.pathname) || "/";
  const url = new URL(pathname, origin);
  const incoming = new URLSearchParams((loc && loc.search) || "");
  for (const key of ["code", "error", "error_code", "error_description"]) incoming.delete(key);
  for (const [key, value] of incoming.entries()) url.searchParams.append(key, value);
  const hash = String((loc && loc.hash) || "");
  if (
    hash &&
    !/access_token=|refresh_token=|provider_token=|error_description=/.test(hash) &&
    !/^#error(=|&|$)/.test(hash)
  ) {
    url.hash = hash;
  }
  return url.toString();
}

/**
 * Custom-scheme URL that asks the OS to open the page in Chrome.
 * Empty when we don't have a scheme (desktop, or a non-https page).
 * Safari has no public URL scheme, so iOS users paste the copied link.
 */
export function externalBrowserHref(pageUrl, ua) {
  let url;
  try {
    url = new URL(String(pageUrl || ""));
  } catch (_) {
    return "";
  }
  if (url.protocol !== "https:") return "";
  const agent = String(ua || "");
  if (/Android/i.test(agent)) {
    return "googlechrome://navigate?url=" + encodeURIComponent(url.toString());
  }
  if (/iPhone|iPad|iPod/i.test(agent)) {
    return "googlechromes://" + url.host + url.pathname + url.search + url.hash;
  }
  return "";
}

export async function copyText(text, deps = {}) {
  const value = String(text || "");
  if (!value) return { ok: false };
  const clipboard = deps.clipboard || (typeof navigator !== "undefined" ? navigator.clipboard : null);
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(value);
      return { ok: true };
    } catch (_) { /* fall through to execCommand */ }
  }
  const doc = deps.document || (typeof document !== "undefined" ? document : null);
  if (!doc || typeof doc.createElement !== "function" || !doc.body || typeof doc.execCommand !== "function") {
    return { ok: false };
  }
  const el = doc.createElement("textarea");
  el.value = value;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "-9999px";
  doc.body.appendChild(el);
  el.focus();
  el.select();
  let ok = false;
  try {
    ok = doc.execCommand("copy");
  } catch (_) {
    ok = false;
  }
  doc.body.removeChild(el);
  return { ok: !!ok };
}
