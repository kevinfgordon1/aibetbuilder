import assert from "node:assert/strict";
import {
  UNDERDOG_RELAY_SILENT_MS,
  underdogRelayFromEnv,
  underdogRelayFresh,
  createUnderdogBook,
} from "./underdogRelayStream.js";
import { underdogRelayStreamUrl } from "./venueLive.js";

assert.equal(UNDERDOG_RELAY_SILENT_MS, 10_000);
assert.equal(underdogRelayFromEnv(undefined), true);
assert.equal(underdogRelayFromEnv("0"), false);
assert.equal(underdogRelayFromEnv("off"), false);
assert.equal(underdogRelayFresh(0, 50_000), false);
assert.equal(underdogRelayFresh(40_000, 49_999), true);
assert.equal(underdogRelayFresh(40_000, 50_000), false);

const g = (id, american, extra = {}) => ({ matchId: id, sport: "NCAAF", lines: [{ market: "h2h", american }], ...extra });
const ev = (kind, seq, extra = {}) => ({ v: 1, kind, seq, t: 1, league: "NCAAF", ...extra });

{
  const book = createUnderdogBook();
  assert.equal(book.apply(ev("delta", 1, { up: [], rm: [] })).kind, "gap", "no base yet");
  assert.equal(book.apply(ev("snapshot", 10, { games: [g(1, -110), g(2, 150)] })).kind, "snapshot");
  assert.equal(book.payload().games.length, 2);
  assert.equal(book.payload().ok, true);
  assert.equal(book.apply(ev("tick", 11)).changed, false);
  const d = book.apply(ev("delta", 12, { up: [g(1, -125), g(3, 200)], rm: [2] }));
  assert.equal(d.kind, "delta");
  const games = book.payload().games;
  assert.deepEqual(games.map((x) => x.matchId).sort(), [1, 3]);
  assert.equal(games.find((x) => x.matchId === 1).lines[0].american, -125);
  assert.equal(book.apply(ev("delta", 14, { up: [], rm: [] })).kind, "gap", "skipped seq = lost event");
  assert.equal(book.apply(ev("error", 0, { error: "boom" })).kind, "error");
  assert.equal(book.apply({ v: 2, kind: "snapshot" }).kind, "ignore");
  assert.equal(book.apply(null).kind, "ignore");
}

// URL: off without a relay base; league only
assert.equal(underdogRelayStreamUrl({ league: "NCAAF" }), null, "no VITE_ODDS_RELAY_URL in node tests");
process.env.VITE_ODDS_RELAY_URL = "https://relay.example/";
assert.equal(underdogRelayStreamUrl({ league: "NCAAF" }), "https://relay.example/underdog?league=NCAAF");
process.env.VITE_UNDERDOG_RELAY = "off";
assert.equal(underdogRelayStreamUrl({ league: "NCAAF" }), null);
delete process.env.VITE_UNDERDOG_RELAY;
delete process.env.VITE_ODDS_RELAY_URL;

console.log("underdogRelayStream.test.js ok");
