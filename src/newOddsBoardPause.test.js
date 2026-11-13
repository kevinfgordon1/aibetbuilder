import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEW_ODDS_BOARD_PAUSED } from "./newOddsBoardPause.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
const stamp = fs.readFileSync(path.join(dir, "BetstampOddsBoard.jsx"), "utf8");

assert.equal(typeof NEW_ODDS_BOARD_PAUSED, "boolean");

assert.match(app, /import \{ NEW_ODDS_BOARD_PAUSED \} from "\.\/newOddsBoardPause\.js"/);
assert.match(app, /New Odds Board is paused\./);
assert.match(app, /activeTab === "oddsBetstamp" && canSeeNewOddsBoard\(user\)/);
assert.match(app, /NEW_ODDS_BOARD_PAUSED \?/);
assert.match(app, /<BetstampOddsBoard user=\{user\} refreshKey=\{betstampRefreshKey\}/);
assert.match(app, /if \(NEW_ODDS_BOARD_PAUSED\) return;/);
assert.match(app, /NEW_ODDS_BOARD_PAUSED && parsed\.tab === "oddsBetstamp"/);
assert.match(app, /NEW_ODDS_BOARD_PAUSED && tab === "oddsBetstamp"\) return;/);
assert.match(app, /initialAppTab\(bootAppHash\(window\.location\)\)/);

const gate = app.indexOf('activeTab === "oddsBetstamp" && canSeeNewOddsBoard(user)');
const pausedCopy = app.indexOf("New Odds Board is paused.", gate);
const liveMount = app.indexOf("<BetstampOddsBoard", gate);
assert.ok(gate > 0 && pausedCopy > gate && liveMount > pausedCopy, "paused copy replaces the live mount");

// The board implementation stays. Pausing does not delete its feeds.
assert.match(stamp, /polymarketStreamUrl/);
assert.match(stamp, /kalshiStreamUrl/);
assert.match(stamp, /ElectionBoard/);
assert.match(stamp, /data-board-sport="politics"/);
assert.match(stamp, /americanfootball_nfl/);
