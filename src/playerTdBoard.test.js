import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { feeInclusiveAmerican } from "./venueTakerFee.js";

const require = createRequire(import.meta.url);
const { boardYesAmerican, fairYesAmericanFromNo, noAskAmericanFromYesBid } = require("../lib/player-td.js");

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
assert.doesNotMatch(panel, /id: "two"|id: "first"/);
assert.match(panel, /formatAmericanOdds/);
assert.match(panel, /PLAYER_TD_POLL_MS = 45_000/);
assert.doesNotMatch(panel, /DraftKings|FanDuel|cents/);

assert.equal(boardYesAmerican(0.64, 0.07), feeInclusiveAmerican(0.64, 0.07).american);
assert.equal(boardYesAmerican(0.285, 0.07), feeInclusiveAmerican(0.285, 0.07).american);

const noAmerican = noAskAmericanFromYesBid(0.36, 0.07);
const fair = fairYesAmericanFromNo(noAmerican);
assert.equal(typeof fair, "number");
assert.ok(Number.isInteger(fair));
assert.notEqual(String(fair).includes("."), true);

console.log("playerTdBoard.test.js ok");
