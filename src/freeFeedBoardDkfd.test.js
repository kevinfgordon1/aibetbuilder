import assert from "node:assert/strict";
import {
  gamesFromFreeFeeds,
  sportsbookQuotesForRows,
  confirmSportsbookQuotes,
  sportsbookFeedState,
  DKFD_FEED_SILENT_MS,
} from "./freeFeedBoard.js";
import { dkfdStreamUrl } from "./venueLive.js";

// No relay in node tests: no DK/FD stream URL.
assert.equal(dkfdStreamUrl({ league: "NFL", book: "draftkings" }), null);
process.env.VITE_ODDS_RELAY_URL = "https://relay.example/";
assert.equal(dkfdStreamUrl({ league: "NFL", book: "draftkings" }), "https://relay.example/stream?venue=draftkings&league=NFL");
assert.equal(dkfdStreamUrl({ league: "NCAAF", book: "fanduel" }), "https://relay.example/stream?venue=fanduel&league=NCAAF");
assert.equal(dkfdStreamUrl({ league: "NFL", book: "betmgm" }), null);
process.env.VITE_DKFD_FEED = "0";
assert.equal(dkfdStreamUrl({ league: "NFL", book: "draftkings" }), null, "VITE_DKFD_FEED=0 is the kill switch");
delete process.env.VITE_DKFD_FEED;
delete process.env.VITE_ODDS_RELAY_URL;

// ---------------------------------------------------------------------------
// DraftKings / FanDuel from the odds relay.
{
  const t = Date.parse("2026-10-11T17:00:00Z");
  const kalshiRow = {
    book: "kalshi", book_id: 194, league: "NFL", away: "Minnesota", home: "New Orleans",
    side: "Minnesota", bet_type: "moneyline", odds: 0.56, ticker: "KXNFLGAME-26OCT11MINNO-MIN",
    start: "2026-10-11T17:00:00Z", updated_at: "2026-10-07T05:00:00Z",
  };
  const kalshiRow2 = { ...kalshiRow, side: "New Orleans", odds: 0.46, ticker: "KXNFLGAME-26OCT11MINNO-NO" };
  const dkQ = (sideType, odds, extra = {}) => ({
    book: "draftkings", book_id: 200, league: "NFL", away: "MIN Vikings", home: "NO Saints",
    side: sideType === "Away" ? "MIN Vikings" : sideType === "Home" ? "NO Saints" : sideType,
    side_type: sideType, bet_type: "moneyline", odds, start: "2026-10-11T17:00:00.000Z",
    token_id: `dk:1:moneyline:${sideType}`, updated_at: "2026-10-07T05:00:00.000Z", ...extra,
  });
  const fdQ = (sideType, odds, extra = {}) => ({
    book: "fanduel", book_id: 100, league: "NFL", away: "Minnesota Vikings", home: "New Orleans Saints",
    side: sideType === "Away" ? "Minnesota Vikings" : sideType === "Home" ? "New Orleans Saints" : sideType,
    side_type: sideType, bet_type: "moneyline", odds, start: "2026-10-11T17:01:00.000Z",
    token_id: `fd:1:moneyline:${sideType}`, updated_at: "2026-10-07T05:00:00.000Z", ...extra,
  });
  const dk = [
    dkQ("Away", -135), dkQ("Home", 114),
    dkQ("Home", -2.5 < 0 ? -110 : 0, { bet_type: "spread", line: 2.5, token_id: "dk:1:spread:Home" }),
    dkQ("Away", -110, { bet_type: "spread", line: -2.5, token_id: "dk:1:spread:Away" }),
    dkQ("Over", -105, { bet_type: "total", line: 42.5, token_id: "dk:1:total:Over" }),
    dkQ("Under", -115, { bet_type: "total", line: 42.5, token_id: "dk:1:total:Under" }),
  ];
  const fd = [fdQ("Away", -130), fdQ("Home", 110)];
  const games = gamesFromFreeFeeds({ league: "NFL", kalshi: [kalshiRow, kalshiRow2], draftkings: dk, fanduel: fd, nowMs: t - 3 * 86400_000 });
  assert.equal(games.length, 1, "DK / FD fill the Kalshi row, no new row");
  const g = games[0];
  assert.equal(g.bookOdds.draftkings.ml_away, -135);
  assert.equal(g.bookOdds.draftkings.ml_home, 114);
  assert.equal(g.bookOdds.draftkings.spr_away, -110);
  assert.equal(g.bookOdds.draftkings.spr_away_line, -2.5);
  assert.equal(g.bookOdds.draftkings.tot_over, -105);
  assert.equal(g.bookOdds.draftkings.tot_line, 42.5);
  assert.equal(g.bookOdds.fanduel.ml_away, -130);
  assert.equal(g.bookOdds.fanduel.ml_home, 110);

  // No row of their own: a DK-only game stays off the board.
  const lonely = gamesFromFreeFeeds({ league: "NFL", draftkings: dk, nowMs: t - 3 * 86400_000 });
  assert.equal(lonely.length, 0);

  // Same teams, different kickoff (next meeting): not this row.
  const later = dk.map((q) => ({ ...q, start: "2026-12-20T18:00:00.000Z" }));
  assert.equal(sportsbookQuotesForRows(games, later, "NFL").length, 0);
  assert.equal(sportsbookQuotesForRows(games, dk, "NFL").length, dk.length);
  // Flipped home / away (neutral site) still lands on the right side.
  const flipped = [{ ...fdQ("Away", 105), away: "New Orleans Saints", home: "Minnesota Vikings", side: "New Orleans Saints" }];
  const fg = gamesFromFreeFeeds({ league: "NFL", kalshi: [kalshiRow, kalshiRow2], fanduel: flipped, nowMs: t - 3 * 86400_000 });
  assert.equal(fg[0].bookOdds.fanduel.ml_home, 105);

  // Feed confirm: a still price re-read 3s ago is 3s old.
  const okAt = Date.parse("2026-10-07T05:30:00Z");
  const confirmed = confirmSportsbookQuotes(dk, { last_ok_at: okAt });
  assert.ok(confirmed.every((q) => Date.parse(q.updated_at) === okAt));
  assert.equal(dk[0].updated_at, "2026-10-07T05:00:00.000Z", "input not mutated");
  const newer = [{ ...dk[0], updated_at: "2026-10-07T05:31:00.000Z" }];
  assert.equal(confirmSportsbookQuotes(newer, { last_ok_at: okAt })[0].updated_at, "2026-10-07T05:31:00.000Z");
  assert.equal(confirmSportsbookQuotes(dk, null), dk);
  const cg = gamesFromFreeFeeds({ league: "NFL", kalshi: [kalshiRow, kalshiRow2], draftkings: confirmed, nowMs: okAt + 3000 });
  assert.equal(cg[0].bookLineUpdatedAt.draftkings.ml_away, okAt);

  // Feed state: fresh / lagging / silent (banner) / blocked.
  const now = okAt + 1000;
  assert.equal(sportsbookFeedState(null, now).state, "unknown");
  assert.equal(sportsbookFeedState({ last_ok_at: okAt }, now).state, "fresh");
  assert.equal(sportsbookFeedState({ last_ok_at: okAt }, okAt + 25_000).state, "lagging");
  assert.equal(sportsbookFeedState({ last_ok_at: okAt }, okAt + DKFD_FEED_SILENT_MS).state, "silent");
  assert.equal(sportsbookFeedState({ last_ok_at: okAt, state: "blocked" }, okAt + 5 * 60_000).state, "blocked");
  assert.equal(sportsbookFeedState({ last_ok_at: null, state: "blocked" }, now).state, "blocked");
  assert.equal(DKFD_FEED_SILENT_MS, 120_000);
}

console.log("freeFeedBoardDkfd.test.js ok");
