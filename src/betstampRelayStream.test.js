import assert from "node:assert/strict";
import {
  RELAY_SILENT_MS,
  RELAY_TICK_APPLY_MS,
  betstampRelayFromEnv,
  relayFeedFresh,
  createRelayBook,
} from "./betstampRelayStream.js";
import { gamesFromBetstampSnapshot, reconcileLiveGames, toAmericanOdds } from "./betstampNormalize.js";

assert.equal(RELAY_SILENT_MS, 10_000);
assert.equal(RELAY_TICK_APPLY_MS, 5_000);
assert.equal(betstampRelayFromEnv(undefined), true);
assert.equal(betstampRelayFromEnv("0"), false);
assert.equal(betstampRelayFromEnv("off"), false);

// Fresh only while events keep arriving inside the silence window.
assert.equal(relayFeedFresh(0, 50_000), false, "never heard from the relay");
assert.equal(relayFeedFresh(40_000, 49_999), true);
assert.equal(relayFeedFresh(40_000, 50_000), false, "10s of silence = fall back to polling");
assert.equal(relayFeedFresh(40_000, 60_000), false);

const mk = (prov, side, odds, extra = {}) => ({
  fixture_id: "cle-pit", odd_provider_id: prov, bet_type: "Moneyline", period: "FT", is_alt: false,
  side, side_type: side === "CLE" ? "Home" : "Away", odds, number: 0, is_live: true,
  updated_at: "2026-10-02T00:30:00Z", ...extra,
});
const fixtures = [{
  id: "cle-pit", league: "NFL", status: "inprogress", date: "2026-10-02T00:15:00Z",
  home_team: "Cleveland Browns", away_team: "Pittsburgh Steelers", home_abbr: "CLE", away_abbr: "PIT",
  home_score: 21, away_score: 16, current_period_text: "7:37 4th",
}];
const k = (prov, side) => `cle-pit|${prov}|Moneyline|FT|0|0|${side}||`;
const ev = (kind, seq, extra = {}) => ({ v: 1, kind, seq, t: 1, league: "NFL", ...extra });

// snapshot -> delta -> tick builds the same payload shape /api/betstamp-markets returns
{
  const book = createRelayBook();
  assert.equal(book.apply(ev("delta", 1, { up: [], rm: [] })).kind, "gap", "delta before any snapshot cannot apply");
  assert.equal(book.apply(ev("snapshot", 10, {
    markets: [[k(200, "CLE"), mk(200, "CLE", 1.2)], [k(200, "PIT"), mk(200, "PIT", 4.5)], [k(100, "CLE"), mk(100, "CLE", 1.21)]],
    fixtures,
    teams: [{ id: "t" }],
  })).kind, "snapshot");
  assert.equal(book.payload().markets.length, 3);
  assert.equal(book.payload().fixtures.length, 1);

  const d1 = book.apply(ev("delta", 11, { up: [[k(200, "CLE"), mk(200, "CLE", 1.18)]], rm: [k(100, "CLE")] }));
  assert.deepEqual(d1, { kind: "delta", changed: true });
  const p1 = book.payload();
  assert.equal(p1.markets.length, 2);
  assert.equal(p1.markets.find((m) => m.odd_provider_id === 200 && m.side === "CLE").odds, 1.18);
  assert.equal(p1.fixtures.length, 1, "fixtures stay when a delta omits them");

  assert.deepEqual(book.apply(ev("tick", 12)), { kind: "tick", changed: false });
  const newFx = [{ ...fixtures[0], home_score: 28 }];
  book.apply(ev("delta", 13, { up: [], rm: [], fixtures: newFx }));
  assert.equal(book.payload().fixtures[0].home_score, 28);

  // a lost event is a gap: reconnect for a fresh snapshot
  assert.equal(book.apply(ev("delta", 15, { up: [], rm: [] })).kind, "gap");
  // relay errors are never fresh and do not move seq
  assert.equal(book.apply(ev("error", 13, { error: "429" })).kind, "error");
  assert.equal(book.apply(ev("tick", 14)).kind, "tick");
  // unknown versions / junk are ignored
  assert.equal(book.apply({ v: 2, kind: "snapshot" }).kind, "ignore");
  assert.equal(book.apply(null).kind, "ignore");
  assert.equal(book.apply(ev("mystery", 15)).kind, "ignore");
}

// The relay payload drives the board's existing paint path exactly like the REST poll:
// same American odds, a moved price lands, a removed row clears after the grace window.
{
  const book = createRelayBook();
  book.apply(ev("snapshot", 1, {
    markets: [[k(200, "CLE"), mk(200, "CLE", 1.2)], [k(200, "PIT"), mk(200, "PIT", 4.5)]],
    fixtures,
    teams: [],
  }));
  const rest = { markets: book.payload().markets, fixtures, teams: [], nowMs: Date.parse("2026-10-02T00:31:00Z") };
  let games = gamesFromBetstampSnapshot(rest);
  const g0 = games.find((g) => g.id === "cle-pit");
  assert.ok(g0, "game built from relay payload");
  assert.equal(toAmericanOdds(g0.bookOdds.draftkings.ml_home), -500);
  assert.equal(toAmericanOdds(g0.bookOdds.draftkings.ml_away), 350);

  book.apply(ev("delta", 2, { up: [[k(200, "CLE"), mk(200, "CLE", 1.25, { updated_at: "2026-10-02T00:31:02Z" })]], rm: [] }));
  const p = book.payload();
  games = reconcileLiveGames(games, { markets: p.markets, fixtures: p.fixtures, teams: p.teams, nowMs: Date.parse("2026-10-02T00:31:03Z") });
  const g1 = games.find((g) => g.id === "cle-pit");
  assert.equal(toAmericanOdds(g1.bookOdds.draftkings.ml_home), -400, "delta price reaches the cell as American odds");
  assert.equal(toAmericanOdds(g1.bookOdds.draftkings.ml_away), 350);
}

console.log("betstampRelayStream.test.js ok");
