import test from "node:test";
import assert from "node:assert/strict";
import { isNativeApp, pushTokenRow, registerPushForUser } from "./push.js";
test("web is a no-op", async () => {
  assert.equal(isNativeApp(null), false);
  assert.equal((await registerPushForUser({}, { id: "u" }, { cap: { isNativePlatform: () => false } })).reason, "web");
  assert.equal(pushTokenRow("u", "t", "web"), null);
  assert.equal(pushTokenRow("u", "t", "ios").platform, "ios");
});
