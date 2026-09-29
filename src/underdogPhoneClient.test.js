import assert from "node:assert/strict";
import { fetchUnderdogPhone, underdogPhoneUrl } from "./underdogPhoneClient.js";

assert.equal(underdogPhoneUrl({ live: true }), "/api/underdog-predict?live=1");
assert.equal(underdogPhoneUrl(), "/api/underdog-predict");

// Normal response passes through.
{
  const body = await fetchUnderdogPhone(async () => ({ json: async () => ({ ok: true, games: [{ matchId: 1 }] }) }), { live: true });
  assert.equal(body.games.length, 1);
}

// A stalled request rejects after the timeout instead of hanging forever.
{
  const t0 = Date.now();
  await assert.rejects(
    fetchUnderdogPhone(() => new Promise(() => {}), { live: true, timeoutMs: 50 }),
    /timed out/,
  );
  assert.ok(Date.now() - t0 < 1000);
}

// A stalled body also times out.
{
  await assert.rejects(
    fetchUnderdogPhone(async () => ({ json: () => new Promise(() => {}) }), { timeoutMs: 50 }),
    /timed out/,
  );
}

// Network errors still reject (callers keep polling on schedule).
await assert.rejects(fetchUnderdogPhone(async () => { throw new Error("network"); }, { timeoutMs: 50 }), /network/);

// Malformed body → empty slate.
{
  const body = await fetchUnderdogPhone(async () => ({ json: async () => ({ nope: 1 }) }), { timeoutMs: 50 });
  assert.deepEqual(body.games, []);
}

console.log("underdogPhoneClient tests passed");
