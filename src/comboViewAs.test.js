// "View as" client: reads are batched to /api/combo-view-as, writes never leave
// the browser, and combo API calls carry x-view-as while viewing.
import assert from "node:assert/strict";
import { createViewAsClient, installViewAsFetch, isComboApiUrl, viewAsBanner, viewAsSender, VIEW_AS_HEADER } from "./comboViewAs.js";

const KENNY = "42b5ee16-68d5-4b3b-a931-40aa17cd1a47";

const sent = [];
const client = createViewAsClient({
  realClient: { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } },
  targetId: KENNY,
  send: async (id, queries) => { sent.push({ id, queries }); return queries.map((q, i) => ({ data: [{ i, table: q.table || q.name }], error: null })); },
});

// Reads: one batch per tick, chain recorded faithfully.
const [a, b, c] = await Promise.all([
  client.from("combo_parlays").select("*").eq("user_id", "ignored").is("archived_at", null).order("created_at", { ascending: false }).limit(5),
  client.from("combo_settings").select("kill_switch").eq("user_id", "x").maybeSingle(),
  client.rpc("combo_my_fee_status"),
]);
assert.equal(sent.length, 1, "batched into one request");
assert.equal(sent[0].id, KENNY);
const qs = sent[0].queries;
const byTable = (t) => qs.find((q) => q.table === t);
assert.deepEqual(byTable("combo_parlays"), {
  table: "combo_parlays", select: "*", selectOpts: null,
  filters: [{ op: "eq", args: ["user_id", "ignored"] }, { op: "is", args: ["archived_at", null] }],
  order: [{ column: "created_at", ascending: false }], limit: 5, single: null,
});
assert.equal(byTable("combo_settings").single, "maybe");
assert.ok(qs.some((q) => q.kind === "rpc" && q.name === "combo_my_fee_status"));
assert.equal(qs.length, 3);
assert.equal(a.data[0].table, "combo_parlays");
assert.equal(c.data[0].table, "combo_my_fee_status");

// Writes: resolve with a read-only error and never hit the network.
const before = sent.length;
for (const w of [
  client.from("combo_parlays").insert({ a: 1 }),
  client.from("combo_parlays").update({ active: false }).eq("id", "p1"),
  client.from("combo_parlays").delete().eq("id", "p1"),
  client.from("combo_settings").upsert({ user_id: KENNY, kill_switch: false }),
  client.rpc("combo_charge_fill_fee"),
]) {
  const r = await w;
  assert.equal(r.error.code, "view_as_read_only");
}
await new Promise((r) => setTimeout(r, 5));
assert.equal(sent.length, before, "no write was sent");

// Sender posts to /api/combo-view-as with the owner's token.
const calls = [];
const send = viewAsSender({ auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } },
  async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => ({ ok: true, results: [{ data: 1 }] }) }; });
assert.deepEqual(await send(KENNY, [{ table: "combo_parlays" }]), [{ data: 1 }]);
assert.equal(calls[0][0], "/api/combo-view-as");
assert.equal(calls[0][1].headers.authorization, "Bearer tok");
assert.equal(JSON.parse(calls[0][1].body).view_as, KENNY);

// Fetch guard: header on combo APIs, local 403 on combo writes, untouched elsewhere.
assert.equal(isComboApiUrl("/api/combo-lock-orders"), true);
assert.equal(isComboApiUrl("/api/stripe-checkout"), true);
assert.equal(isComboApiUrl("/api/kalshi-games"), false);
const seen = [];
const win = { fetch: async (url, init) => { seen.push([url, init]); return { ok: true }; } };
const origFetch = win.fetch;
const restore = installViewAsFetch(KENNY, win);
await win.fetch("/api/combo-keys", { headers: { authorization: "Bearer t" } });
assert.equal(seen[0][1].headers[VIEW_AS_HEADER], KENNY);
assert.equal(seen[0][1].headers.authorization, "Bearer t");
await win.fetch("/api/kalshi-games");
assert.equal(seen[1][1] && seen[1][1].headers, undefined, "non-combo calls untouched");
for (const [url, method] of [["/api/combo-lock-orders", "POST"], ["/api/combo-probe", "POST"], ["/api/combo-keys", "DELETE"], ["/api/stripe-checkout", "POST"]]) {
  const r = await win.fetch(url, { method, body: "{}" });
  assert.equal(r.status, 403, url);
}
assert.equal(seen.length, 2, "blocked writes never reached the network");
restore();
assert.equal(win.fetch, origFetch, "restored when switching back");

assert.match(viewAsBanner("Kenny"), /^Viewing as Kenny, read-only/);
console.log("comboViewAs tests passed");
