import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  browserClientFromEnv,
  getBrowserSupabase,
  resetBrowserSupabaseForTests,
  userAfterAuthEvent,
} from "./supabaseBrowser.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

{
  let calls = 0;
  const created = browserClientFromEnv(
    { url: "https://example.supabase.co", key: "anon" },
    (url, key) => {
      calls += 1;
      return { url, key };
    },
  );
  assert.equal(calls, 1);
  assert.equal(created.url, "https://example.supabase.co");
  assert.equal(created.key, "anon");
  assert.equal(browserClientFromEnv({ url: "", key: "anon" }, () => { throw new Error("no"); }), null);
  assert.equal(browserClientFromEnv({ url: "https://example.supabase.co", key: "" }, () => { throw new Error("no"); }), null);
  assert.equal(browserClientFromEnv(null, () => { throw new Error("no"); }), null);
  const errors = [];
  const origError = console.error;
  console.error = (...args) => { errors.push(args); };
  let broken = null;
  try {
    broken = browserClientFromEnv(
      { url: "https://example.supabase.co", key: "anon" },
      () => { throw new Error("boom"); },
    );
  } finally {
    console.error = origError;
  }
  assert.equal(broken, null);
  assert.equal(errors.length, 1);
}

{
  const calls = [];
  resetBrowserSupabaseForTests({
    env: { url: "https://example.supabase.co", key: "anon" },
    create(url, key) {
      const client = { url, key, n: calls.length + 1 };
      calls.push(client);
      return client;
    },
  });
  const first = getBrowserSupabase();
  const second = getBrowserSupabase();
  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.equal(first.n, 1);

  resetBrowserSupabaseForTests({
    env: { url: "", key: "" },
    create() { throw new Error("should not create"); },
  });
  assert.equal(getBrowserSupabase(), null);
  assert.equal(getBrowserSupabase(), null);
  resetBrowserSupabaseForTests();
}

{
  const user = { id: "user-1", email: "fan@example.com" };
  const session = { access_token: "token", user };
  let reads = 0;
  const client = {
    auth: {
      async getSession() {
        reads += 1;
        return { data: { session }, error: null };
      },
    },
  };
  const signedIn = await userAfterAuthEvent(client, "SIGNED_IN", session);
  assert.equal(signedIn, user);
  assert.equal(reads, 0);
  const refreshed = await userAfterAuthEvent(client, "TOKEN_REFRESHED", session);
  assert.equal(refreshed, user);
  assert.equal(reads, 0);
  const raced = await userAfterAuthEvent(client, "SIGNED_OUT", null);
  assert.equal(raced, user);
  assert.equal(reads, 1);

  const empty = {
    auth: { async getSession() { return { data: { session: null }, error: null }; } },
  };
  assert.equal(await userAfterAuthEvent(empty, "SIGNED_OUT", null), null);
  const thrown = {
    auth: { async getSession() { throw new Error("offline"); } },
  };
  assert.equal(await userAfterAuthEvent(thrown, "SIGNED_OUT", { user }), null);
  assert.equal(await userAfterAuthEvent(null, "SIGNED_OUT", null), null);
  assert.equal(await userAfterAuthEvent({ auth: {} }, "INITIAL_SESSION", null), null);
}

{
  const browserFiles = [
    "App.jsx",
    "ComboLocks.jsx",
    "ComboTape.jsx",
    "UserProfile.jsx",
    "LiveTradingDesk.jsx",
    "RootFor.jsx",
    "SniperDashboard.jsx",
  ];
  for (const name of browserFiles) {
    const src = fs.readFileSync(path.join(dir, name), "utf8");
    assert.match(src, /getBrowserSupabase/, name);
    assert.doesNotMatch(src, /createClient\(/, name);
    assert.doesNotMatch(src, /@supabase\/supabase-js/, name);
  }
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /userAfterAuthEvent/);
  assert.match(app, /event === "SIGNED_OUT"/);
}

console.log("supabaseBrowser.test.js ok");
