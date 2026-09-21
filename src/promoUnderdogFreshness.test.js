import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ALL_BOOKS, TRUSTED_BOOK_KEYS } from "../lib/promo-ev.js";
import { transformOddsData } from "./oddsTransform.js";
import { overlayUnderdogPredictOnGame } from "./promoUnderdogPredict.js";
import {
  UNDERDOG_PREDICT_BOOK_KEY,
  UNDERDOG_STALE_MINUTES,
  UNDERDOG_STALE_MS,
  UNDERDOG_STALE_WARNING,
  assignBookUpdatedAt,
  describePromoUnderdogStaleWarning,
  describeUnderdogOfferStaleWarning,
  describeUnderdogStaleWarning,
  formatUnderdogUpdatedAtEt,
  isUnderdogOddsStale,
  isUnderdogPredictBook,
  parseUnderdogUpdatedAtMs,
  underdogOfferIsRankable,
  underdogOfferUpdatedAtFromLeg,
  underdogPairIncomplete,
  underdogStaleAgeLabel,
} from "./promoUnderdogFreshness.js";

const require = createRequire(import.meta.url);
const { buildAllLegsForBook, findTopParlays } = require("../lib/promo-ev.js");
const cjsFresh = require("../lib/underdog-freshness.js");

const dir = path.dirname(fileURLToPath(import.meta.url));
const kick = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

{
  assert.equal(UNDERDOG_STALE_MINUTES, 60);
  assert.equal(UNDERDOG_STALE_MS, 60 * 60 * 1000);
  assert.equal(isUnderdogPredictBook(UNDERDOG_PREDICT_BOOK_KEY), true);
  assert.equal(isUnderdogPredictBook("draftkings"), false);
  assert.match(UNDERDOG_STALE_WARNING, /double-check in the app/i);
}

{
  const now = Date.parse("2026-09-19T18:00:00.000Z");
  assert.equal(parseUnderdogUpdatedAtMs(null), null);
  assert.equal(parseUnderdogUpdatedAtMs(""), null);
  assert.equal(parseUnderdogUpdatedAtMs("nope"), null);
  assert.equal(parseUnderdogUpdatedAtMs(0), null);
  assert.equal(parseUnderdogUpdatedAtMs(-5), null);
  assert.equal(parseUnderdogUpdatedAtMs(now), now);
  assert.equal(parseUnderdogUpdatedAtMs("2026-09-19T18:00:00.000Z"), now);
}

{
  const now = Date.parse("2026-09-19T18:00:00.000Z");
  // > 60m → flag; ≤ 60m → no flag; missing → no false alarm.
  assert.equal(isUnderdogOddsStale(now - UNDERDOG_STALE_MS - 1, now), true);
  assert.equal(isUnderdogOddsStale(now - UNDERDOG_STALE_MS, now), false);
  assert.equal(isUnderdogOddsStale(now - 59 * 60 * 1000, now), false);
  assert.equal(isUnderdogOddsStale(now - 4 * 60 * 60 * 1000, now), true);
  assert.equal(isUnderdogOddsStale(null, now), false);
  assert.equal(isUnderdogOddsStale(undefined, now), false);
  assert.equal(isUnderdogOddsStale("", now), false);
  assert.equal(isUnderdogOddsStale("not-a-date", now), false);
  assert.equal(cjsFresh.UNDERDOG_STALE_MS, UNDERDOG_STALE_MS);
  assert.equal(cjsFresh.isUnderdogOddsStale(now - UNDERDOG_STALE_MS - 1, now), true);
  assert.equal(cjsFresh.isUnderdogOddsStale(null, now), false);
}

{
  const now = Date.parse("2026-09-21T20:20:00.000Z");
  const miamiTs = Date.parse("2026-09-13T02:16:09.235Z");
  const cmuTs = Date.parse("2026-09-21T19:35:16.513Z");
  const staleLeg = { bookKey: "underdog_predict", bookUpdatedAt: miamiTs, dk: -1112, name: "Miami (FL) Hurricanes ML" };
  const freshLeg = { bookKey: "underdog_predict", bookUpdatedAt: cmuTs, dk: 3230, name: "Central Michigan Chippewas ML" };
  const missingLeg = { bookKey: "underdog_predict", dk: 150, name: "Raiders ML" };
  const dkLeg = { bookKey: "draftkings", bookUpdatedAt: miamiTs, dk: -110, name: "Chiefs ML" };
  assert.equal(underdogOfferIsRankable(staleLeg, now), false);
  assert.equal(underdogOfferIsRankable(freshLeg, now), true);
  assert.equal(underdogOfferIsRankable(missingLeg, now), true, "missing stamp is not a false stale");
  assert.equal(underdogOfferIsRankable(dkLeg, now), true, "other books stay rankable");
  assert.equal(cjsFresh.underdogOfferIsRankable(staleLeg, now), false);
  assert.equal(cjsFresh.underdogOfferIsRankable(freshLeg, now), true);
  assert.equal(underdogPairIncomplete("underdog_predict", 3230, null), false, "one fresh Underdog side can still be an offer");
  assert.equal(underdogPairIncomplete("underdog_predict", null, null), true);
  assert.equal(underdogPairIncomplete("draftkings", -110, null), true);
  assert.equal(cjsFresh.h2hPairIncoherent([
    { market: "h2h", american: -527 },
    { market: "h2h", american: -715 },
  ]), true, "Akron −527 / CMU −715 is not a two-way");
  assert.equal(cjsFresh.h2hPairIncoherent([
    { market: "h2h", american: -110 },
    { market: "h2h", american: -110 },
  ]), false, "−110 / −110 stays");
  assert.equal(underdogStaleAgeLabel(miamiTs, now), "~8d ago");
  assert.ok((now - miamiTs) / 3_600_000 > 200, "Miami quote is ~210 hours old");
}

{
  const now = Date.parse("2026-09-19T18:00:00.000Z");
  const stale = now - 4 * 60 * 60 * 1000;
  const fresh = now - 12 * 60 * 1000;
  const warn = describeUnderdogStaleWarning(stale, now);
  assert.ok(warn);
  assert.equal(warn.stale, true);
  assert.equal(warn.ageLabel, "~4h ago");
  assert.match(warn.message, /over 1 hour ago/);
  assert.match(warn.message, /~4h ago/);
  assert.match(warn.message, /double-check in the app/);
  assert.match(warn.et, /ET$/);
  assert.equal(describeUnderdogStaleWarning(fresh, now), null);
  assert.equal(describeUnderdogStaleWarning(null, now), null);
  assert.equal(underdogStaleAgeLabel(stale, now), "~4h ago");
  assert.ok(formatUnderdogUpdatedAtEt(stale));
}

{
  const now = Date.parse("2026-09-19T18:00:00.000Z");
  const stale = now - 3 * 60 * 60 * 1000;
  const udStale = {
    name: "Pittsburgh Steelers ML",
    bookKey: "underdog_predict",
    bookUpdatedAt: stale,
    bestOppBook: "draftkings",
  };
  const udFresh = {
    name: "Cleveland Browns ML",
    bookKey: "underdog_predict",
    bookUpdatedAt: now - 8 * 60 * 1000,
  };
  const udMissing = { name: "Raiders ML", bookKey: "underdog_predict" };
  const dk = { name: "Chiefs ML", bookKey: "draftkings", bookUpdatedAt: stale };

  assert.ok(describeUnderdogOfferStaleWarning(udStale, now));
  assert.equal(describeUnderdogOfferStaleWarning(udFresh, now), null);
  assert.equal(describeUnderdogOfferStaleWarning(udMissing, now), null, "missing stamp is not a false alarm");
  assert.equal(describeUnderdogOfferStaleWarning(dk, now), null, "non-UD books do not warn even if stale");

  assert.ok(describePromoUnderdogStaleWarning([udStale], now));
  assert.equal(describePromoUnderdogStaleWarning([udFresh], now), null);
  assert.equal(describePromoUnderdogStaleWarning([udMissing], now), null);
  assert.equal(describePromoUnderdogStaleWarning([dk], now), null);
  const mixed = describePromoUnderdogStaleWarning([udFresh, udStale], now);
  assert.ok(mixed, "any stale UD offer on the pick flags the card");
  assert.equal(mixed.ageLabel, "~3h ago");

  const hedgeUd = {
    name: "Saints ML",
    bookKey: "draftkings",
    bestOppBook: "underdog_predict",
    bestOppUpdatedAt: stale,
  };
  assert.ok(describePromoUnderdogStaleWarning([hedgeUd], now), "UD as hedge/true-odds still flags when stamped");
}

{
  const assigned = assignBookUpdatedAt({ name: "x" }, "2026-09-19T14:00:00.000Z");
  assert.equal(assigned.bookUpdatedAt, Date.parse("2026-09-19T14:00:00.000Z"));
  assert.equal(assignBookUpdatedAt({ name: "y" }, null).bookUpdatedAt, undefined);
  assert.equal(underdogOfferUpdatedAtFromLeg({ bookKey: "underdog_predict", bookUpdatedAt: 123 }), 123);
}

{
  const denTs = Date.parse("2026-09-19T13:10:00.000Z");
  const kcTs = Date.parse("2026-09-19T17:15:00.000Z");
  const event = {
    id: "odds-den-kc-fresh",
    sport_key: "americanfootball_nfl",
    sport: "americanfootball_nfl",
    commence_time: kick,
    away_team: "Denver Broncos",
    home_team: "Kansas City Chiefs",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Denver Broncos", price: -110 },
            { name: "Kansas City Chiefs", price: -110 },
          ],
        }],
      },
    ],
  };
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-den-kc-fresh",
      league: "NFL",
      start_date: kick,
      home_team_id: "team-kc",
      away_team_id: "team-den",
    }],
    teams: [
      { id: "team-den", name: "Denver Broncos", abbreviation: "DEN" },
      { id: "team-kc", name: "Kansas City Chiefs", abbreviation: "KC" },
    ],
    markets: [
      {
        odds: 2.00, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT",
        is_alt: false, odd_provider_id: 196, fixture_id: "fix-den-kc-fresh", team_id: "team-den",
        updated_at: "2026-09-19T13:10:00.000Z",
      },
      {
        odds: 1.91, side: "KC", side_type: "Home", bet_type: "moneyline", period: "FT",
        is_alt: false, odd_provider_id: 196, fixture_id: "fix-den-kc-fresh", team_id: "team-kc",
        updated_at: "2026-09-19T17:15:00.000Z",
      },
    ],
  };
  const overlaid = overlayUnderdogPredictOnGame(event, null, {
    match_grouped_lines: [{
      title: "Moneyline",
      options: [
        { selection_header: "Denver Broncos", updated_at: "2026-09-19T13:10:00.000Z", odds: { prediction: { american: "+100", decimal: "2.00" } } },
        { selection_header: "Kansas City Chiefs", updated_at: "2026-09-19T17:15:00.000Z", odds: { prediction: { american: "-110", decimal: "1.91" } } },
      ],
    }],
  });
  const h2h = overlaid.bookmakers.find((b) => b.key === "underdog_predict")?.markets?.find((m) => m.key === "h2h");
  const den = h2h.outcomes.find((o) => o.name === "Denver Broncos");
  const kc = h2h.outcomes.find((o) => o.name === "Kansas City Chiefs");
  assert.equal(den.updatedAt, denTs, "overlay keeps per-selection phone updated_at");
  assert.equal(kc.updatedAt, kcTs);
  assert.notEqual(den.updatedAt, kc.updatedAt);
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.equal(ml.bookOdds.underdog_predict.ml_away_updatedAt, denTs);
  assert.equal(ml.bookOdds.underdog_predict.ml_home_updatedAt, kcTs);
  assert.equal(ml.bookOdds.draftkings.ml_away_updatedAt, null);

  const now = Date.parse("2026-09-19T18:00:00.000Z");
  const legs = buildAllLegsForBook(data, "underdog_predict", null, null, "any", null, { now });
  const denLeg = legs.find((l) => /broncos/i.test(l.name));
  const kcLeg = legs.find((l) => /chiefs/i.test(l.name));
  assert.equal(denLeg, undefined, "Denver ~4h 50m is not a Promo candidate");
  assert.equal(kcLeg.bookUpdatedAt, kcTs);
  assert.equal(describeUnderdogOfferStaleWarning(kcLeg, now), null, "KC 45m old stays quiet");
  assert.ok(describeUnderdogStaleWarning(denTs, now), "Denver stamp still warns if a card shows it");
  assert.ok(!findTopParlays(legs, 1, 0, 100).some((p) => (p.legs || []).some((l) => /broncos/i.test(l.name))));
}

{
  // Exactly the Kevin case: Steelers tick 3h+ old vs Browns minutes ago.
  const now = Date.parse("2026-09-19T20:00:00.000Z");
  const event = {
    id: "odds-pit-cle",
    sport_key: "americanfootball_nfl",
    commence_time: kick,
    away_team: "Pittsburgh Steelers",
    home_team: "Baltimore Ravens",
    bookmakers: [{
      key: "draftkings",
      markets: [{
        key: "h2h",
        outcomes: [
          { name: "Pittsburgh Steelers", price: 180 },
          { name: "Baltimore Ravens", price: -220 },
        ],
      }],
    }],
  };
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-pit-bal",
      league: "NFL",
      start_date: kick,
      home_team_id: "bal",
      away_team_id: "pit",
    }],
    teams: [
      { id: "pit", name: "Pittsburgh Steelers", abbreviation: "PIT" },
      { id: "bal", name: "Baltimore Ravens", abbreviation: "BAL" },
    ],
    markets: [
      {
        odds: 2.94, side: "PIT", side_type: "Away", bet_type: "Moneyline", period: "FT",
        is_alt: false, odd_provider_id: 196, fixture_id: "fix-pit-bal", team_id: "pit",
        updated_at: "2026-09-19T16:10:00.000Z",
      },
      {
        odds: 1.30, side: "BAL", side_type: "Home", bet_type: "moneyline", period: "FT",
        is_alt: false, odd_provider_id: 196, fixture_id: "fix-pit-bal", team_id: "bal",
        updated_at: "2026-09-19T19:52:00.000Z",
      },
    ],
  };
  const overlaid = overlayUnderdogPredictOnGame(event, null, {
    match_grouped_lines: [{
      title: "Moneyline",
      options: [
        { selection_header: "Pittsburgh Steelers", updated_at: "2026-09-19T16:10:00.000Z", odds: { prediction: { american: "+194", decimal: "2.94" } } },
        { selection_header: "Baltimore Ravens", updated_at: "2026-09-19T19:52:00.000Z", odds: { prediction: { american: "-333", decimal: "1.30" } } },
      ],
    }],
  });
  const pitH2h = overlaid.bookmakers.find((b) => b.key === "underdog_predict")?.markets?.find((m) => m.key === "h2h");
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const legs = buildAllLegsForBook(data, "underdog_predict", null, null, "any", null, { now });
  const steelers = legs.find((l) => /steelers/i.test(l.name));
  const ravens = legs.find((l) => /ravens/i.test(l.name));
  assert.equal(steelers, undefined, "stale Steelers offer is not ranked");
  assert.ok(ravens);
  assert.equal(describeUnderdogOfferStaleWarning(ravens, now), null, "Ravens minutes-old tick stays quiet");
  assert.ok(describeUnderdogStaleWarning(Date.parse("2026-09-19T16:10:00.000Z"), now), "Steelers tick still warns");
  assert.equal(describePromoUnderdogStaleWarning([ravens], now), null);
}

{
  // Match 183027, Central Michigan @ Miami (FL). Live phone lines on
  // 2026-09-21: Miami odds.prediction −1112 with updated_at
  // 2026-09-13T02:16:09.235Z (~210h / ~8d) and Central Michigan +3230 at
  // 2026-09-21T19:35:16.513Z. At 20:20Z CMU is still inside 60 minutes.
  const now = Date.parse("2026-09-21T20:20:00.000Z");
  const miamiTs = "2026-09-13T02:16:09.235Z";
  const cmuTs = "2026-09-21T19:35:16.513Z";
  const event = {
    id: "odds-cmu-mia",
    sport_key: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Central Michigan Chippewas",
    home_team: "Miami (FL) Hurricanes",
    bookmakers: [{
      key: "draftkings",
      markets: [{
        key: "h2h",
        outcomes: [
          { name: "Central Michigan Chippewas", price: 1800 },
          { name: "Miami (FL) Hurricanes", price: -4000 },
        ],
      }],
    }],
  };
  const lobby = {
    match_grouped_lines: [{
      title: "Moneyline",
      options: [
        {
          selection_header: "Central Michigan Chippewas",
          updated_at: cmuTs,
          odds: { prediction: { american: "+3230", decimal: "33.3" } },
        },
        {
          selection_header: "Miami (FL) Hurricanes",
          odds: { prediction: { american: "-1112", decimal: "1.09", updatedAt: miamiTs } },
        },
      ],
    }],
  };
  const overlaid = overlayUnderdogPredictOnGame(event, null, lobby);
  const h2h = overlaid.bookmakers.find((b) => b.key === "underdog_predict").markets.find((m) => m.key === "h2h");
  const miamiOutcome = h2h.outcomes.find((o) => /miami/i.test(o.name));
  const cmuOutcome = h2h.outcomes.find((o) => /central michigan/i.test(o.name));
  assert.equal(miamiOutcome.price, -1112);
  assert.equal(miamiOutcome.updatedAt, Date.parse(miamiTs), "odds.prediction.updatedAt is the Miami quote clock");
  assert.equal(cmuOutcome.updatedAt, Date.parse(cmuTs));
  const data = transformOddsData([overlaid], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const legs = buildAllLegsForBook(data, "underdog_predict", null, null, "any", null, { now });
  const miami = legs.find((l) => /miami/i.test(l.name));
  const cmu = legs.find((l) => /central michigan/i.test(l.name));
  assert.equal(miami, undefined, "frozen Miami −1112 is not a Promo candidate");
  assert.ok(cmu, "fresh Central Michigan side is still a candidate");
  assert.equal(cmu.dk, 3230);
  const ranked = findTopParlays(legs, 1, 0, 100);
  assert.ok(ranked.length >= 1);
  assert.ok(ranked.every((p) => !(p.legs || []).some((l) => /miami/i.test(l.name) && l.dk === -1112)));
  assert.equal(ranked[0].legs[0].name, cmu.name);

  const freshNow = Date.parse(miamiTs) + 30 * 60 * 1000;
  const freshLegs = buildAllLegsForBook(data, "underdog_predict", null, null, "any", null, { now: freshNow });
  const freshMiami = freshLegs.find((l) => /miami/i.test(l.name));
  assert.ok(freshMiami, "a fresh Miami quote is still ranked");
  assert.equal(freshMiami.dk, -1112);
  const freshRanked = findTopParlays(freshLegs, 1, 0, 100);
  assert.ok(freshRanked.some((p) => (p.legs || []).some((l) => l.dk === -1112)), "when the Miami quote is fresh it is ranked");

  const cmuOnly = overlayUnderdogPredictOnGame(event, null, {
    match_grouped_lines: [{
      title: "Moneyline",
      options: [{
        selection_header: "Central Michigan Chippewas",
        updated_at: cmuTs,
        odds: { prediction: { american: "+3230", decimal: "33.3" } },
      }],
    }],
  });
  const oneSide = buildAllLegsForBook(
    transformOddsData([cmuOnly], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS),
    "underdog_predict",
    null,
    null,
    "any",
    null,
    { now },
  );
  assert.equal(oneSide.find((l) => /miami/i.test(l.name)), undefined);
  assert.ok(oneSide.find((l) => /central michigan/i.test(l.name)), "omitting stale Miami does not drop fresh CMU");

  const unstamped = overlayUnderdogPredictOnGame(event, null, {
    match_grouped_lines: [{
      title: "Moneyline",
      options: [
        { selection_header: "Central Michigan Chippewas", odds: { prediction: { american: "+3230" } } },
        { selection_header: "Miami (FL) Hurricanes", odds: { prediction: { american: "-1112" } } },
      ],
    }],
  });
  const kept = buildAllLegsForBook(
    transformOddsData([unstamped], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS),
    "underdog_predict",
    null,
    null,
    "any",
    null,
    { now },
  );
  assert.ok(kept.find((l) => /miami/i.test(l.name)), "missing timestamp is not treated as stale");
  assert.ok(kept.find((l) => /central michigan/i.test(l.name)));
}

{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /from "\.\/promoUnderdogFreshness\.js"/);
  assert.match(app, /function UnderdogStaleOddsBanner/);
  assert.match(app, /function UnderdogStaleOddsChip/);
  assert.match(app, /<UnderdogStaleOddsBanner legs=\{overlay\.displayLegs \|\| p\.legs\} \/>/);
  assert.match(app, /<UnderdogStaleOddsChip leg=\{leg\} \/>/);
  assert.match(app, /<UnderdogStaleOddsChip leg=\{l\} \/>/);
  assert.match(app, /⚠ \{warn\.message\}/);
  assert.match(app, /assignBookUpdatedAt/);
  assert.match(app, /ml_away_updatedAt/);
  assert.match(app, /underdogOfferIsRankable\(l, quoteNow\)/);
  assert.match(app, /underdogOfferIsRankable\(l\)/);
  const promoEv = fs.readFileSync(path.join(dir, "../lib/promo-ev.js"), "utf8");
  assert.match(promoEv, /underdogOfferIsRankable\(l, quoteNow\)/);
  // Banner stays. Ranking excludes the stale offer instead of hiding cards in JSX.
  assert.doesNotMatch(app, /isUnderdogOddsStale\([^)]+\)\s*\?\s*null/);
}

console.log("promoUnderdogFreshness.test.js ok");
