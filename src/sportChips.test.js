import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOCCER_SPORT_KEYS } from "./soccerPairing.js";
import {
  SOCCER_CHIP_ID,
  SOCCER_CHIP_LABEL,
  sportChipOptions,
  isSoccerChipId,
  soccerKeysSelected,
  sportChipSelected,
  toggleSportChip,
  selectedSportChipLabels,
  formatSelectedSportsSummary,
  boardSportMatches,
} from "./sportChips.js";

const SPORTS = [
  { key: "baseball_mlb", label: "MLB" },
  { key: "americanfootball_nfl", label: "NFL" },
  { key: "americanfootball_ncaaf", label: "NCAAF" },
  { key: "basketball_nba", label: "NBA" },
  { key: "basketball_ncaab", label: "NCAAB" },
  { key: "icehockey_nhl", label: "NHL" },
  { key: "soccer_epl", label: "EPL" },
  { key: "soccer_usa_mls", label: "MLS" },
];

const chips = sportChipOptions(SPORTS);
const soccer = chips.find((c) => c.id === SOCCER_CHIP_ID);
const mlb = chips.find((c) => c.id === "baseball_mlb");

assert.equal(SOCCER_CHIP_LABEL, "Soccer");
assert.equal(soccer.label, "Soccer");
assert.deepEqual(soccer.keys, SOCCER_SPORT_KEYS);
assert.equal(chips.filter((c) => c.label === "EPL" || c.label === "MLS").length, 0);
assert.equal(chips.filter((c) => c.label === "Soccer").length, 1);
assert.equal(chips.length, 7);
assert.ok(!chips.some((c) => c.id === "soccer_epl" || c.id === "soccer_usa_mls"));
assert.ok(!chips.some((c) => c.keys.includes("soccer") && c.id !== SOCCER_CHIP_ID));

assert.equal(isSoccerChipId("soccer"), true);
assert.equal(isSoccerChipId("soccer_epl"), true);
assert.equal(isSoccerChipId("soccer_usa_mls"), true);
assert.equal(isSoccerChipId("baseball_mlb"), false);

assert.equal(soccerKeysSelected(new Set(["soccer_epl"])), true);
assert.equal(soccerKeysSelected(new Set(["soccer_usa_mls"])), true);
assert.equal(soccerKeysSelected(new Set(SOCCER_SPORT_KEYS)), true);
assert.equal(soccerKeysSelected(new Set(["baseball_mlb"])), false);

assert.equal(sportChipSelected(soccer, new Set(["soccer_epl"])), true);
assert.equal(sportChipSelected(soccer, new Set(["soccer_usa_mls"])), true);
assert.equal(sportChipSelected(soccer, new Set(["baseball_mlb"])), false);
assert.equal(sportChipSelected(mlb, new Set(["baseball_mlb"])), true);

{
  const on = toggleSportChip(new Set(["baseball_mlb"]), soccer);
  assert.deepEqual([...on].sort(), ["baseball_mlb", "soccer_epl", "soccer_usa_mls"].sort());
}

{
  const off = toggleSportChip(new Set(["baseball_mlb", "soccer_epl"]), soccer);
  assert.deepEqual([...off], ["baseball_mlb"]);
}

{
  const offBoth = toggleSportChip(new Set(["baseball_mlb", ...SOCCER_SPORT_KEYS]), soccer);
  assert.deepEqual([...offBoth], ["baseball_mlb"]);
}

{
  const blocked = toggleSportChip(new Set(["soccer_epl"]), soccer, { minSelected: 1 });
  assert.deepEqual([...blocked], ["soccer_epl"]);
}

{
  const blockedBoth = toggleSportChip(new Set(SOCCER_SPORT_KEYS), soccer, { minSelected: 1 });
  assert.deepEqual([...blockedBoth].sort(), [...SOCCER_SPORT_KEYS].sort());
}

assert.deepEqual(selectedSportChipLabels(new Set(["soccer_epl"]), chips), ["Soccer"]);
assert.deepEqual(selectedSportChipLabels(new Set(SOCCER_SPORT_KEYS), chips), ["Soccer"]);
assert.equal(formatSelectedSportsSummary(new Set(["soccer_epl", "soccer_usa_mls"]), chips), "Soccer");
assert.equal(formatSelectedSportsSummary(new Set(["baseball_mlb", "soccer_epl"]), chips), "MLB, Soccer");
assert.doesNotMatch(formatSelectedSportsSummary(new Set(["soccer_epl", "soccer_usa_mls"]), chips), /EPL|MLS/);
assert.equal(formatSelectedSportsSummary(new Set(SPORTS.map((s) => s.key)), chips), "All sports");
assert.equal(
  formatSelectedSportsSummary(new Set(["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf", "basketball_nba", "basketball_ncaab", "icehockey_nhl", "soccer_epl"]), chips),
  "All sports",
);

assert.equal(boardSportMatches("soccer_epl", "soccer"), true);
assert.equal(boardSportMatches("soccer_usa_mls", "soccer"), true);
assert.equal(boardSportMatches("soccer_epl", "soccer_epl"), true);
assert.equal(boardSportMatches("soccer_usa_mls", "soccer_epl"), true);
assert.equal(boardSportMatches("baseball_mlb", "soccer"), false);
assert.equal(boardSportMatches("baseball_mlb", "baseball_mlb"), true);
assert.equal(boardSportMatches("soccer_epl", "baseball_mlb"), false);

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /const SPORT_CHIPS = sportChipOptions\(SPORTS\)/);
  assert.match(app, /SPORT_CHIPS\.map/);
  assert.match(app, /formatSelectedSportsSummary\(promoSports, SPORT_CHIPS\)/);
  assert.match(app, /toggleSportChip\(prev, chip/);
  assert.match(app, /expandSoccerSportKeys\(promoSports\)/);
  assert.doesNotMatch(app, /SPORTS\.map\(s => \(\s*\n\s*<button key=\{s\.key\}/);
  assert.match(app, /key: "soccer_epl", label: "EPL"/);
  assert.match(app, /key: "soccer_usa_mls", label: "MLS"/);
  const profileUi = fs.readFileSync(path.join(dir, "UserProfile.jsx"), "utf8");
  assert.match(profileUi, /toggleSportChip/);
  assert.match(profileUi, /sportChipSelected/);
}

console.log("sportChips.test.js ok");
