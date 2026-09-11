import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOCCER_SPORT_KEYS,
  SOCCER_ML_SIDES,
  isSoccerSport,
  isDrawOutcomeName,
  soccerYesName,
  soccerNoName,
  soccerLayOutcomeName,
  outcomeMatchesName,
  preferSoccerBinaryNo,
  soccerMlOppResolveArgs,
} from "./soccerPairing.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cjs = require("../lib/soccer-pairing.js");

assert.deepEqual(SOCCER_SPORT_KEYS, ["soccer_epl", "soccer_usa_mls"]);
assert.deepEqual(SOCCER_ML_SIDES, ["away", "draw", "home"]);
assert.equal(isSoccerSport("soccer_epl"), true);
assert.equal(isSoccerSport("soccer_usa_mls"), true);
assert.equal(isSoccerSport("americanfootball_nfl"), false);
assert.equal(isSoccerSport("baseball_mlb"), false);
assert.equal(isDrawOutcomeName("Draw"), true);
assert.equal(isDrawOutcomeName("tie"), true);
assert.equal(isDrawOutcomeName("Arsenal"), false);

{
  const away = "Chelsea";
  const home = "Arsenal";
  assert.equal(soccerYesName("home", away, home), "Arsenal ML");
  assert.equal(soccerYesName("away", away, home), "Chelsea ML");
  assert.equal(soccerYesName("draw", away, home), "Draw");
  assert.equal(soccerNoName("home", away, home), "Arsenal ML No");
  assert.equal(soccerNoName("away", away, home), "Chelsea ML No");
  assert.equal(soccerNoName("draw", away, home), "Draw No");
  assert.equal(soccerLayOutcomeName("home", away, home), "Arsenal");
  assert.equal(soccerLayOutcomeName("draw", away, home), "Draw");
  assert.equal(outcomeMatchesName("Draw", "Tie"), true);
  assert.equal(outcomeMatchesName("Arsenal", "Arsenal"), true);
  assert.equal(outcomeMatchesName("Chelsea", "Arsenal"), false);
}

// Soft Home Yes ↔ PM Home No. Away Yes must not win even if it is a better price.
{
  const homeNo = { best: -140, bestBook: "kalshi", bestSize: 800, count: 2 };
  const awayYes = { best: 210, bestBook: "polymarket", bestSize: 400, count: 1 };
  const picked = preferSoccerBinaryNo(homeNo, awayYes);
  assert.equal(picked.kind, "same_binary_no");
  assert.equal(picked.best, -140);
  assert.equal(picked.bestBook, "kalshi");
  assert.notEqual(picked.best, awayYes.best);
}

{
  const awayYes = { best: 180, bestBook: "novig", bestSize: 50, count: 1 };
  const picked = preferSoccerBinaryNo(null, awayYes);
  assert.equal(picked.kind, "none");
  assert.equal(picked.best, null);
  assert.equal(picked.bestBook, null);
}

{
  const game = {
    best_home_no: 155,
    best_home_no_book: "polymarket",
    best_home_no_size: 600,
    ml_opp_count_home: 2,
    best_away: 200,
    best_away_book: "kalshi",
    bookOdds: {
      draftkings: { ml_home: -120, ml_away: 280, ml_draw: 240 },
      kalshi: { ml_home_no: 150, ml_home_no_size: 200 },
    },
  };
  const args = soccerMlOppResolveArgs(game, "home", "draftkings");
  assert.equal(args.trustedOpp, 155);
  assert.equal(args.trustedBook, "polymarket");
  assert.equal(args.trustedSize, 600);
  assert.equal(args.sameBookOpp, null, "soft book has no Home No");
  const kalshiOffer = soccerMlOppResolveArgs(game, "home", "kalshi");
  assert.equal(kalshiOffer.sameBookOpp, 150);
  assert.equal(kalshiOffer.sameBookSize, 200);
}

for (const key of Object.keys(cjs)) {
  if (typeof cjs[key] === "function") {
    assert.equal(typeof cjs[key], "function", `CJS missing ${key}`);
  }
}
assert.deepEqual(cjs.SOCCER_SPORT_KEYS, SOCCER_SPORT_KEYS);
assert.equal(cjs.preferSoccerBinaryNo({ best: 100 }, { best: 999 }).best, 100);
assert.equal(cjs.preferSoccerBinaryNo(null, { best: 999 }).best, null);

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /key: "soccer_epl", label: "EPL"/);
  assert.match(app, /key: "soccer_usa_mls", label: "MLS"/);
  assert.match(app, /function pushSoccerMlLegs/);
  assert.match(app, /isSoccerSport\(g\.sport\)/);
  assert.doesNotMatch(app, /DEFAULT_PROFILE_SPORTS = \[[^\]]*soccer/);
  const profile = fs.readFileSync(path.join(dir, "userProfile.js"), "utf8");
  assert.match(profile, /DEFAULT_PROFILE_SPORTS = \["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf"\]/);
  const fetchJob = fs.readFileSync(path.join(dir, "../lib/odds-fetch-job.js"), "utf8");
  assert.match(fetchJob, /h2h,h2h_lay,spreads,totals/);
  assert.match(fetchJob, /Do not pull alt props/);
}

console.log("soccerPairing.test.js ok");
