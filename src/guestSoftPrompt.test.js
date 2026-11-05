import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldShowSoftPrompt,
  markSoftPromptShown,
  hasStoredAuthSession,
  canShowGuestSoftPrompt,
  GUEST_FULL_PICKS,
  GUEST_SOFT_PROMPT_QUIET_MS,
  GUEST_SOFT_PROMPT_COPY,
  GUEST_SOFT_PROMPT_TITLE,
  GUEST_SOFT_PROMPT_OPTIMIZES,
} from "./guestAccess.js";

const mk = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
assert.equal(GUEST_FULL_PICKS, 2);
assert.equal(GUEST_SOFT_PROMPT_OPTIMIZES, 2);
assert.equal(GUEST_SOFT_PROMPT_TITLE, "Browsing as a guest");
assert.match(GUEST_SOFT_PROMPT_COPY, /browsing as a guest/i);
assert.match(GUEST_SOFT_PROMPT_COPY, /save your boosts/);
assert.doesNotMatch(GUEST_SOFT_PROMPT_COPY, /signed out/i);
assert.doesNotMatch(GUEST_SOFT_PROMPT_TITLE, /signed out|continue/i);

const local = mk(); let session = mk();
assert.equal(shouldShowSoftPrompt(1000, { local, session }), true);
markSoftPromptShown(1000, { local, session });
assert.equal(shouldShowSoftPrompt(2000, { local, session }), false);
session = mk();
assert.equal(shouldShowSoftPrompt(1000 + GUEST_SOFT_PROMPT_QUIET_MS - 1, { local, session }), false);
assert.equal(shouldShowSoftPrompt(1000 + GUEST_SOFT_PROMPT_QUIET_MS + 1, { local, session }), true);

function storageFrom(entries) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(entries, k) ? entries[k] : null),
  };
}

assert.equal(hasStoredAuthSession(null), false);
assert.equal(hasStoredAuthSession(storageFrom({})), false);
assert.equal(hasStoredAuthSession(storageFrom({ "abb_soft_signin_prompt_at": "1" })), false);
assert.equal(hasStoredAuthSession(storageFrom({
  "sb-example-auth-token-code-verifier": "verifier",
})), false);
assert.equal(hasStoredAuthSession(storageFrom({ "sb-example-auth-token": "" })), false);
assert.equal(hasStoredAuthSession(storageFrom({ "sb-example-auth-token": "{}" })), false);
assert.equal(hasStoredAuthSession(storageFrom({
  "sb-xuolkiadmumtbksbyjzc-auth-token": JSON.stringify({ access_token: "a", refresh_token: "r" }),
})), true);

const sessionStorage = storageFrom({
  "sb-proj-auth-token": JSON.stringify({ refresh_token: "r" }),
});
assert.equal(canShowGuestSoftPrompt({ user: null, authLoading: true, storage: storageFrom({}) }), false);
assert.equal(canShowGuestSoftPrompt({ user: { id: "u" }, authLoading: false, storage: storageFrom({}) }), false);
assert.equal(canShowGuestSoftPrompt({ user: null, authLoading: false, storage: sessionStorage }), false);
assert.equal(canShowGuestSoftPrompt({ user: null, authLoading: false, storage: storageFrom({}) }), true);

{
  const app = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "App.jsx"), "utf8");
  const access = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "guestAccess.js"), "utf8");
  assert.match(app, /canShowGuestSoftPrompt/);
  assert.match(app, /GUEST_SOFT_PROMPT_TITLE/);
  assert.match(app, /signInSource === "soft_prompt"/);
  assert.match(app, /guestOptimizeCount < GUEST_SOFT_PROMPT_OPTIMIZES/);
  assert.match(app, /markSoftPromptShown/);
  assert.doesNotMatch(app, /guestTimeUp|GUEST_SOFT_PROMPT_DELAY_MS/);
  assert.doesNotMatch(access, /GUEST_SOFT_PROMPT_DELAY_MS/);
  assert.match(access, /7 \* 24 \* 60 \* 60 \* 1000/);
}

console.log("guestSoftPrompt.test.js ok");
