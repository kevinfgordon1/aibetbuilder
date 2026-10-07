import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_NEXT_PARAM,
  X_OAUTH_PROVIDER,
  SIGN_IN_PROVIDERS,
  normalizeSignInEmail,
  isPlausibleEmail,
  safeAppHash,
  authNextHash,
  bootAppHash,
  buildAuthRedirectUrl,
  restoreAuthReturnUrl,
  describeAuthError,
  authCallbackError,
  startOAuthSignIn,
  sendMagicLink,
} from "./signIn.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

assert.equal(X_OAUTH_PROVIDER, "x");
assert.deepEqual(SIGN_IN_PROVIDERS, ["google", "x", "facebook"]);
assert.equal(normalizeSignInEmail("  A@B.com "), "a@b.com");
assert.equal(isPlausibleEmail("a@b.com"), true);
assert.equal(isPlausibleEmail("not-an-email"), false);
assert.equal(isPlausibleEmail(""), false);

assert.equal(safeAppHash("#ev"), "#ev");
assert.equal(safeAppHash("#promo/boost.draftkings.100.abc"), "#promo/boost.draftkings.100.abc");
assert.equal(safeAppHash("#ev/draftkings.xyz"), "#ev/draftkings.xyz");
assert.equal(safeAppHash("#new-odds-board"), "#new-odds-board");
assert.equal(safeAppHash("#access_token=abc"), "");
assert.equal(safeAppHash("#error=access_denied&error_description=nope"), "");
assert.equal(safeAppHash("#//evil.com"), "");
assert.equal(safeAppHash("https://evil.example/#ev"), "");

{
  const loc = {
    origin: "https://www.aibetbuilder.io",
    pathname: "/",
    search: "",
    hash: "#promo/boost.draftkings.100.abc",
  };
  const redirect = buildAuthRedirectUrl(loc);
  const url = new URL(redirect);
  assert.equal(url.origin, "https://www.aibetbuilder.io");
  assert.equal(url.searchParams.get(AUTH_NEXT_PARAM), "#promo/boost.draftkings.100.abc");
  assert.equal(url.hash, "");
  assert.equal(authNextHash(url.search), "#promo/boost.draftkings.100.abc");
}

{
  const loc = {
    origin: "https://aibetbuilder.io",
    pathname: "/",
    search: "?utm=1&code=old&auth_next=%23stale",
    hash: "#ev/draftkings.xyz",
  };
  const url = new URL(buildAuthRedirectUrl(loc));
  assert.equal(url.searchParams.get("utm"), "1");
  assert.equal(url.searchParams.get("code"), null);
  assert.equal(url.searchParams.get(AUTH_NEXT_PARAM), "#ev/draftkings.xyz");
}

{
  const returned = {
    origin: "https://www.aibetbuilder.io",
    pathname: "/",
    search: "?utm=1&auth_next=" + encodeURIComponent("#ev/draftkings.xyz") + "&code=abc",
    hash: "#access_token=secret&refresh_token=r",
  };
  assert.equal(bootAppHash(returned), "#ev/draftkings.xyz");
  assert.equal(restoreAuthReturnUrl(returned), "/?utm=1#ev/draftkings.xyz");
  assert.equal(restoreAuthReturnUrl({ origin: "https://www.aibetbuilder.io", pathname: "/", search: "", hash: "#ev" }), "");
  assert.equal(
    restoreAuthReturnUrl({
      origin: "https://www.aibetbuilder.io",
      pathname: "/",
      search: "?auth_next=" + encodeURIComponent("#ev"),
      hash: "#promo",
    }),
    "/#promo",
  );
}

{
  const rate = describeAuthError({ message: "Email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" });
  assert.equal(rate.kind, "rate_limit");
  const wait = describeAuthError({ message: "For security purposes, you can only request this after 60 seconds.", code: "over_request_rate_limit" });
  assert.equal(wait.kind, "rate_limit");
  const disabled = describeAuthError({ message: "Unsupported provider: Provider is not enabled", status: 400, code: "validation_failed" });
  assert.equal(disabled.kind, "error");
  assert.match(disabled.message, /isn’t turned on yet/);
  const bad = describeAuthError({ message: "Unable to validate email address: invalid format" });
  assert.equal(bad.message, "Enter a valid email address.");
  const callback = authCallbackError({
    hash: "#error=access_denied&error_code=400&error_description=" + encodeURIComponent("Provider is not enabled"),
    search: "",
  });
  assert.equal(callback.kind, "error");
  assert.match(callback.message, /isn’t turned on yet/);
}

{
  const calls = [];
  const client = {
    auth: {
      async signInWithOAuth(args) {
        calls.push(args);
        return { data: { url: "https://provider.example" }, error: null };
      },
      async signInWithOtp() {
        throw new Error("should not send");
      },
    },
  };
  const loc = { origin: "https://www.aibetbuilder.io", pathname: "/", search: "", hash: "#ev" };
  const google = await startOAuthSignIn(client, "google", loc);
  assert.equal(google.ok, true);
  assert.equal(calls[0].provider, "google");
  assert.equal(new URL(calls[0].options.redirectTo).searchParams.get(AUTH_NEXT_PARAM), "#ev");
  const fb = await startOAuthSignIn(client, "facebook", loc);
  assert.equal(fb.ok, true);
  assert.equal(calls[1].provider, "facebook");
  assert.equal(calls[1].options.scopes, "email,public_profile");
  const x = await startOAuthSignIn(client, X_OAUTH_PROVIDER, loc);
  assert.equal(x.ok, true);
  assert.equal(calls[2].provider, "x");
  const denied = await startOAuthSignIn({
    auth: {
      async signInWithOAuth() {
        return { data: null, error: { message: "Unsupported provider: Provider is not enabled", status: 400 } };
      },
    },
  }, "x", loc);
  assert.equal(denied.ok, false);
  assert.match(denied.message, /isn’t turned on yet/);
  const down = await startOAuthSignIn(null, "google", loc);
  assert.equal(down.ok, false);
  assert.match(down.message, /temporarily unavailable/);
}

{
  const loc = { origin: "https://www.aibetbuilder.io", pathname: "/", search: "", hash: "#promo/boost.draftkings.100.abc" };
  const invalid = await sendMagicLink({ auth: { async signInWithOtp() { throw new Error("no"); } } }, "nope", loc);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.message, "Enter a valid email address.");
  let sentArgs = null;
  const sent = await sendMagicLink({
    auth: {
      async signInWithOtp(args) {
        sentArgs = args;
        return { data: { user: null, session: null }, error: null };
      },
    },
  }, "  Fan@Example.com ", loc);
  assert.equal(sent.ok, true);
  assert.equal(sent.kind, "sent");
  assert.equal(sent.email, "fan@example.com");
  assert.equal(sent.message, "Check your email");
  assert.equal(sentArgs.email, "fan@example.com");
  assert.equal(sentArgs.options.shouldCreateUser, true);
  assert.equal(new URL(sentArgs.options.emailRedirectTo).searchParams.get(AUTH_NEXT_PARAM), "#promo/boost.draftkings.100.abc");
  const limited = await sendMagicLink({
    auth: {
      async signInWithOtp() {
        return { error: { message: "Email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" } };
      },
    },
  }, "fan@example.com", loc);
  assert.equal(limited.kind, "rate_limit");
}

{
  const types = fs.readFileSync(path.join(dir, "..", "node_modules", "@supabase", "auth-js", "src", "lib", "types.ts"), "utf8");
  const providerBlock = types.slice(types.indexOf("export type Provider ="), types.indexOf("export type AuthChangeEventMFA"));
  assert.match(providerBlock, /\| 'x'/);
  assert.match(providerBlock, /OAuth 2\.0/);
  if (!providerBlock.includes("| 'x'")) {
    assert.equal(X_OAUTH_PROVIDER, "twitter");
  }
}

{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const panel = fs.readFileSync(path.join(dir, "SignInOptions.jsx"), "utf8");
  const access = fs.readFileSync(path.join(dir, "comboAccess.js"), "utf8");
  assert.match(app, /<SignInPanel/);
  assert.match(app, /setShowLanding\(true\)/);
  assert.match(app, /data-guest-explainer/);
  assert.match(app, /askSignIn\(/);
  assert.match(app, /signin-prompt-title/);
  assert.match(app, /Sign in to continue/);
  assert.match(panel, /Send me a sign-in link/);
  assert.match(panel, /Check your email/);
  assert.match(panel, /data-signin-google/);
  assert.match(panel, /data-signin-x/);
  assert.match(panel, /data-signin-facebook/);
  assert.match(panel, /data-signin-error/);
  assert.match(panel, /data-signin-rate-limit/);
  assert.match(panel, /data-signin-sent/);
  assert.match(app, /function LandingFull/);
  assert.doesNotMatch(app, /signInWithOAuth\(\{ provider: "google", options: \{ redirectTo: window\.location\.origin \} \}\)/);
  assert.match(access, /user\.email/);
  assert.doesNotMatch(access, /user\.email \|\| meta\.email/);
}

console.log("signIn.test.js ok");
