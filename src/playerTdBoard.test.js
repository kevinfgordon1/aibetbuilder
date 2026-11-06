import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { feeInclusiveAmerican } from "./venueTakerFee.js";
import { PLAYER_TD_FETCH_TIMEOUT_MS, reducePlayerTdLoad } from "./playerTdBoardState.js";

const require = createRequire(import.meta.url);
const { boardYesAmerican, fairYesAmericanFromNo, noAskAmericanFromYesBid } = require("../lib/player-td.cjs");
const { BOARD_DEADLINE_MS } = require("../lib/player-td-feeds");

const board = fs.readFileSync(new URL("./BetstampOddsBoard.jsx", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("./PlayerTdBoard.jsx", import.meta.url), "utf8");
assert.match(board, /data-board-market=\{m\.id\}/);
assert.match(board, /id: "props", label: "Player Props"/);
assert.doesNotMatch(board, /Player TDs/);
assert.doesNotMatch(board, /data-board-market="td"/);
assert.match(board, /market === "props"/);
assert.match(panel, /Anytime touchdown/);
assert.match(panel, /id: "anytime", label: "Anytime TD"/);
assert.match(panel, /PLAYER_PROP_TYPES\[0\]\.id/);
assert.match(panel, /data-prop-type=\{item\.id\}/);
assert.match(panel, /data-td-kickoff="1"/);
assert.match(panel, /formatKickoffEt/);
assert.doesNotMatch(panel, /id: "two"|id: "first"/);
assert.match(panel, /formatAmericanOdds/);
assert.match(panel, /PLAYER_TD_POLL_MS = 45_000/);
assert.match(panel, /data-td-notice="1"/);
assert.match(panel, /data-td-stale=\{stale \? "1" : "0"\}/);
assert.match(panel, /reducePlayerTdLoad/);
assert.match(panel, /AbortSignal\.timeout\(PLAYER_TD_FETCH_TIMEOUT_MS\)/);
assert.match(panel, /formatAmericanOdds/);
assert.doesNotMatch(panel, /setGames\(\[\]\)/);
assert.doesNotMatch(panel, /DraftKings|FanDuel|cents/);
assert.equal(PLAYER_TD_FETCH_TIMEOUT_MS, 10_000);
assert.ok(PLAYER_TD_FETCH_TIMEOUT_MS > BOARD_DEADLINE_MS);
assert.ok(PLAYER_TD_FETCH_TIMEOUT_MS < 12_000);

const kelceGame = [{
  gameKey: "KC|MIA|2026-09-27",
  players: [{ name: "Travis Kelce", anytime: { kalshi: -155, polymarket: -150, underdog_predict: null, best: -150, bestBook: "polymarket" } }],
}];
const fresh = reducePlayerTdLoad({ games: [] }, {
  httpOk: true,
  body: { ok: true, games: kelceGame, fetchedAt: "2026-09-26T12:00:00.000Z", stale: false, partial: false, sources: { kalshi: "ok", polymarket: "ok", underdog: "empty", novig: "skipped" } },
});
assert.equal(fresh.error, "");
assert.equal(fresh.notice, "");
assert.equal(fresh.games[0].players[0].anytime.kalshi, -155);
assert.equal(String(fresh.games[0].players[0].anytime.kalshi).includes("."), false);

const partial = reducePlayerTdLoad({ games: [] }, {
  httpOk: true,
  body: {
    ok: true,
    partial: true,
    stale: false,
    games: kelceGame,
    fetchedAt: "2026-09-26T12:00:00.000Z",
    sources: { kalshi: "ok", polymarket: "timeout", underdog: "error", novig: "skipped" },
  },
});
assert.equal(partial.partial, true);
assert.match(partial.notice, /Polymarket/);
assert.match(partial.notice, /Underdog/);
assert.doesNotMatch(partial.notice, /Novig/);
assert.equal(partial.games[0].players[0].anytime.polymarket, -150);

const kept = reducePlayerTdLoad({ games: kelceGame, fetchedAt: "2026-09-26T12:00:00.000Z", partial: false }, {
  httpOk: false,
  body: { ok: false, games: [], error: "player_td_unavailable", sources: { kalshi: "timeout" } },
});
assert.equal(kept.games.length, 1);
assert.equal(kept.stale, true);
assert.equal(kept.error, "");
assert.match(kept.notice, /last player TD board/);
assert.equal(kept.games[0].players[0].anytime.kalshi, -155);

const aborted = reducePlayerTdLoad({ games: kelceGame, fetchedAt: "2026-09-26T12:00:00.000Z" }, { aborted: true, httpOk: false, body: null });
assert.equal(aborted.games[0].players[0].name, "Travis Kelce");
assert.equal(aborted.stale, true);

const down = reducePlayerTdLoad({ games: [] }, { httpOk: false, body: { ok: false, games: [] } });
assert.deepEqual(down.games, []);
assert.match(down.error, /unavailable/);
assert.equal(down.notice, "");

assert.equal(boardYesAmerican(0.64, 0.07), feeInclusiveAmerican(0.64, 0.07).american);
assert.equal(boardYesAmerican(0.285, 0.07), feeInclusiveAmerican(0.285, 0.07).american);

const noAmerican = noAskAmericanFromYesBid(0.36, 0.07);
const fair = fairYesAmericanFromNo(noAmerican);
assert.equal(typeof fair, "number");
assert.ok(Number.isInteger(fair));
assert.notEqual(String(fair).includes("."), true);

console.log("playerTdBoard.test.js ok");
