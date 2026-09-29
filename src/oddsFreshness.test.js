import assert from "node:assert/strict";
import {
  ODDS_FRESHNESS,
  consensusMoved,
  maskStaleOdds,
  maskedOddsReason,
  recordConsensus,
  setLineFlag,
} from "./oddsFreshness.js";
import { applyStreamMarkets } from "./betstampNormalize.js";
import { applyUnderdogPhoneQuotes } from "./underdogPredictionQuote.js";
import { getBestForGame } from "./oddsBoard.js";

const NOW = Date.parse("2026-09-29T01:20:00Z");
const KICK = "2026-09-29T00:15:00Z";

function game({ live = true, odds = {}, stamps = {}, flags } = {}) {
  return {
    id: "g1",
    away: "Philadelphia Eagles",
    home: "Chicago Bears",
    commence_time: KICK,
    is_live: live,
    bookOdds: odds,
    bookLineUpdatedAt: stamps,
    ...(flags ? { bookLineFlags: flags } : {}),
  };
}
const ml = (a, h) => ({ ml_away: a, ml_home: h });
const at = (msAgo) => ({ ml_away: NOW - msAgo, ml_home: NOW - msAgo });

// Constants live in one block.
assert.equal(ODDS_FRESHNESS.LIVE_FROZEN_MIN_AGE_MS, 90_000);
assert.equal(ODDS_FRESHNESS.LIVE_MAX_AGE_MS, 300_000);
assert.equal(ODDS_FRESHNESS.PREGAME_FROZEN_MIN_AGE_MS, 1_800_000);
assert.equal(ODDS_FRESHNESS.CONSENSUS_MOVE_CENTS, 15);

// Cents ladder crosses ±100; long prices use probability.
assert.equal(consensusMoved(-135, -150), true);
assert.equal(consensusMoved(-105, 110), true);
assert.equal(consensusMoved(-110, -120), false);
assert.equal(consensusMoved(400, 430), false);
assert.equal(consensusMoved(400, 300), true);

// Nothing stale → same object.
{
  const g = game({ odds: { pinnacle: ml(120, -140), kalshi: ml(118, -138) }, stamps: { pinnacle: at(5_000), kalshi: at(2_000) } });
  assert.equal(maskStaleOdds(g, { nowMs: NOW, tape: new Map() }), g);
}

// Source flag hides immediately, with a reason, and Best skips it.
{
  const g = game({
    odds: { circa: ml(150, -170), pinnacle: ml(120, -140) },
    stamps: { circa: at(1_000), pinnacle: at(1_000) },
    flags: { circa: { ml_away: "off the board", ml_home: "off the board" } },
  });
  const m = maskStaleOdds(g, { nowMs: NOW, tape: new Map() });
  assert.equal(m.bookOdds.circa.ml_away, null);
  assert.equal(maskedOddsReason(m, "circa", "ml_away"), "suspended (off the board)");
  assert.equal(g.bookOdds.circa.ml_away, 150, "input not mutated");
  const books = [{ key: "circa", label: "Circa" }, { key: "pinnacle", label: "Pinnacle" }];
  const best = getBestForGame(m, "ml", new Set(["circa", "pinnacle"]), books, { nowMs: NOW });
  assert.equal(best.bestAway, 120, "hidden Circa +150 is not Best");
}

// Live hard cap: older than 5 minutes.
{
  const g = game({ odds: { betcris: ml(130, -150) }, stamps: { betcris: at(6 * 60_000) } });
  const m = maskStaleOdds(g, { nowMs: NOW, tape: new Map() });
  assert.equal(maskedOddsReason(m, "betcris", "ml_away"), "frozen 6m");
}

// Live pregame leftover: stamped before kickoff.
{
  const g = game({ odds: { fanduel: ml(110, -130) }, stamps: { fanduel: { ml_away: Date.parse(KICK) - 60_000 } } });
  const m = maskStaleOdds(g, { nowMs: Date.parse(KICK) + 60_000, tape: new Map() });
  assert.match(maskedOddsReason(m, "fanduel", "ml_away"), /pregame line/);
}

// Frozen with consensus history: stamped 3m ago, consensus moved since.
{
  const tape = new Map();
  const t0 = NOW - 180_000;
  const before = game({
    odds: { pinnacle: ml(120, -140), kalshi: ml(118, -138), polymarket: ml(122, -142), betcris: ml(120, -140) },
    stamps: { pinnacle: { ml_away: t0, ml_home: t0 }, kalshi: { ml_away: t0, ml_home: t0 }, polymarket: { ml_away: t0, ml_home: t0 }, betcris: { ml_away: t0, ml_home: t0 } },
  });
  recordConsensus(before, { nowMs: t0, tape });
  const after = game({
    odds: { pinnacle: ml(-150, 128), kalshi: ml(-148, 125), polymarket: ml(-152, 130), betcris: ml(120, -140) },
    stamps: { pinnacle: at(3_000), kalshi: at(2_000), polymarket: at(1_000), betcris: { ml_away: t0, ml_home: t0 } },
  });
  const m = maskStaleOdds(after, { nowMs: NOW, tape });
  assert.equal(maskedOddsReason(m, "betcris", "ml_away"), "frozen 3m, market moved");
  assert.equal(m.bookOdds.pinnacle.ml_away, -150);
  // Under the gate the same stale-looking price stays.
  const fresh = { ...after, bookLineUpdatedAt: { ...after.bookLineUpdatedAt, betcris: at(30_000) } };
  assert.equal(maskedOddsReason(maskStaleOdds(fresh, { nowMs: NOW, tape }), "betcris", "ml_away"), null);
}

// Old but market did not move → stays (quiet book, not frozen).
{
  const tape = new Map();
  const t0 = NOW - 150_000;
  const g0 = game({ odds: { pinnacle: ml(120, -140), kalshi: ml(118, -138), circa: ml(121, -141) }, stamps: { pinnacle: at(150_000), kalshi: at(150_000), circa: at(150_000) } });
  recordConsensus(g0, { nowMs: t0, tape });
  const g1 = game({ odds: { pinnacle: ml(122, -142), kalshi: ml(119, -139), circa: ml(121, -141) }, stamps: { pinnacle: at(2_000), kalshi: at(2_000), circa: at(150_000) } });
  assert.equal(maskedOddsReason(maskStaleOdds(g1, { nowMs: NOW, tape }), "circa", "ml_away"), null);
}

// Fewer than two reference books → consensus rule does not fire.
{
  const g = game({ odds: { pinnacle: ml(-200, 170), betcris: ml(120, -140) }, stamps: { pinnacle: at(1_000), betcris: at(120_000) } });
  assert.equal(maskedOddsReason(maskStaleOdds(g, { nowMs: NOW, tape: new Map() }), "betcris", "ml_away"), null);
}

// Pregame is looser: 10 minutes old and far off consensus stays; 40 minutes hides.
{
  const pre = (ageMs) => game({
    live: false,
    odds: { pinnacle: ml(-150, 130), kalshi: ml(-148, 126), betus: ml(120, -140) },
    stamps: { pinnacle: at(60_000), kalshi: at(60_000), betus: at(ageMs) },
  });
  const nowPre = NOW;
  assert.equal(maskedOddsReason(maskStaleOdds(pre(10 * 60_000), { nowMs: nowPre, tape: new Map() }), "betus", "ml_away"), null);
  assert.equal(maskedOddsReason(maskStaleOdds(pre(40 * 60_000), { nowMs: nowPre, tape: new Map() }), "betus", "ml_away"), "frozen 40m, market moved");
  // No pregame hard cap.
  const lone = game({ live: false, odds: { betus: ml(120, -140) }, stamps: { betus: at(5 * 3600_000) } });
  assert.equal(maskStaleOdds(lone, { nowMs: NOW, tape: new Map() }), lone);
}

// Spread / total line drops only when both sides are hidden.
{
  const g = game({
    odds: { circa: { spr_away: -110, spr_away_line: 2.5, spr_home: -110, spr_home_line: -2.5, tot_over: -105, tot_under: -115, tot_line: 38.5 } },
    stamps: { circa: { spr_away: NOW - 1000, spr_home: NOW - 1000, tot_over: NOW - 1000, tot_under: NOW - 1000 } },
    flags: { circa: { tot_over: "off the board", tot_under: "off the board", spr_away: "off the board" } },
  });
  const m = maskStaleOdds(g, { nowMs: NOW, tape: new Map() });
  assert.equal(m.bookOdds.circa.tot_line, null);
  assert.equal(m.bookOdds.circa.spr_away, null);
  assert.equal(m.bookOdds.circa.spr_away_line, 2.5, "home side still offered at this line");
  assert.equal(m.bookOdds.circa.spr_home, -110);
}

// setLineFlag is copy-on-write.
{
  const a = game({ flags: { circa: { ml_away: null } } });
  const b = { ...a };
  setLineFlag(b, "circa", "ml_away", "off the board");
  assert.equal(a.bookLineFlags.circa.ml_away, null);
  assert.equal(b.bookLineFlags.circa.ml_away, "off the board");
}

// Betstamp is_otb / i_hidden with a price flags the line; the next on-board row clears it.
{
  const base = [{
    id: "fx1", away: "Philadelphia Eagles", home: "Chicago Bears", awayAbbr: "PHI", homeAbbr: "CHI",
    commence_time: KICK, is_live: true, bookOdds: {}, bookUpdatedAt: {}, bookLineUpdatedAt: {}, bookLineConfirmedAt: {}, bookLineSuspended: {},
  }];
  const row = (extra) => ({
    fixture_id: "fx1", odd_provider_id: 150, bet_type: "Total", side: "Over", side_type: "Over", number: 38.5,
    odds: 1.85, is_live: true, is_alt: false, period: "FT", ...extra,
  });
  let { games } = applyStreamMarkets(base, [row({ is_otb: false, i_hidden: false, updated_at: "2026-09-29T01:14:00Z" })], { receivedAt: NOW });
  assert.equal(games[0].bookOdds.circa.tot_over != null, true);
  assert.equal(games[0].bookLineFlags?.circa?.tot_over ?? null, null);
  ({ games } = applyStreamMarkets(games, [row({ is_otb: true, i_hidden: true, updated_at: "2026-09-29T01:14:00Z" })], { receivedAt: NOW + 5000 }));
  assert.equal(games[0].bookLineFlags.circa.tot_over, "off the board");
  const m = maskStaleOdds(games[0], { nowMs: NOW + 5000, tape: new Map() });
  assert.equal(m.bookOdds.circa.tot_over, null);
  ({ games } = applyStreamMarkets(games, [row({ is_otb: false, i_hidden: false, number: 34.5, odds: 1.91, updated_at: "2026-09-29T01:18:08Z" })], { receivedAt: NOW + 10000 }));
  assert.equal(games[0].bookLineFlags.circa.tot_over, null);
}

// Underdog status other than active → suspended.
{
  const g = [{ id: "u1", away: "Philadelphia Eagles", home: "Chicago Bears", commence_time: KICK, is_live: true, bookOdds: {}, bookLineUpdatedAt: {} }];
  const slate = { ok: true, games: [{ away: "Philadelphia Eagles", home: "Chicago Bears", scheduledAt: KICK, lines: [
    { market: "h2h", name: "Philadelphia Eagles", american: -157, updatedAt: NOW - 1000, status: "suspended" },
    { market: "h2h", name: "Chicago Bears", american: 127, updatedAt: NOW - 1000 },
  ] }] };
  const [painted] = applyUnderdogPhoneQuotes(g, slate);
  assert.equal(painted.bookLineFlags.underdog_predict.ml_away, "suspended");
  assert.equal(painted.bookLineFlags.underdog_predict.ml_home, undefined);
  assert.deepEqual(Object.keys(painted.bookLineUpdatedAt.underdog_predict).sort(), ["ml_away", "ml_home"], "flags stay off the stamp map");
  const m = maskStaleOdds(painted, { nowMs: NOW, tape: new Map() });
  assert.equal(maskedOddsReason(m, "underdog_predict", "ml_away"), "suspended");
  assert.equal(m.bookOdds.underdog_predict.ml_home, 127);
}

// Slow-book profile: BetCris is caught after 45s instead of 90s.
{
  const g = (book) => game({
    odds: { pinnacle: ml(-150, 128), kalshi: ml(-148, 125), [book]: ml(120, -140) },
    stamps: { pinnacle: at(2_000), kalshi: at(2_000), [book]: at(60_000) },
  });
  assert.equal(maskedOddsReason(maskStaleOdds(g("betcris"), { nowMs: NOW, tape: new Map() }), "betcris", "ml_away"), "frozen 1m, market moved");
  assert.equal(maskedOddsReason(maskStaleOdds(g("circa"), { nowMs: NOW, tape: new Map() }), "circa", "ml_away"), null);
}

console.log("oddsFreshness tests passed");
