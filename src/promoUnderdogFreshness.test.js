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
  underdogOfferUpdatedAtFromLeg,
  underdogStaleAgeLabel,
} from "./promoUnderdogFreshness.js";

const require = createRequire(import.meta.url);
const { buildAllLegsForBook } = require("../lib/promo-ev.js");

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
  const overlaid = overlayUnderdogPredictOnGame(event, snap);
  const h2h = overlaid.bookmakers.find((b) => b.key === "underdog_predict")?.markets?.find((m) => m.key === "h2h");
  const den = h2h.outcomes.find((o) => o.name === "Denver Broncos");
  const kc = h2h.outcomes.find((o) => o.name === "Kansas City Chiefs");
  assert.equal(den.updatedAt, denTs, "overlay keeps per-selection Betstamp updated_at");
  assert.equal(kc.updatedAt, kcTs);
  assert.notEqual(den.updatedAt, kc.updatedAt);

  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.equal(ml.bookOdds.underdog_predict.ml_away_updatedAt, denTs);
  assert.equal(ml.bookOdds.underdog_predict.ml_home_updatedAt, kcTs);
  assert.equal(ml.bookOdds.draftkings.ml_away_updatedAt, null);

  const legs = buildAllLegsForBook(data, "underdog_predict");
  const denLeg = legs.find((l) => /broncos/i.test(l.name));
  const kcLeg = legs.find((l) => /chiefs/i.test(l.name));
  assert.equal(denLeg.bookUpdatedAt, denTs);
  assert.equal(kcLeg.bookUpdatedAt, kcTs);

  const now = Date.parse("2026-09-19T18:00:00.000Z");
  assert.ok(describeUnderdogOfferStaleWarning(denLeg, now), "Denver ~4h 50m old flags");
  assert.equal(describeUnderdogOfferStaleWarning(kcLeg, now), null, "KC 45m old stays quiet");
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
  const overlaid = overlayUnderdogPredictOnGame(event, snap);
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const legs = buildAllLegsForBook(data, "underdog_predict");
  const steelers = legs.find((l) => /steelers/i.test(l.name));
  const ravens = legs.find((l) => /ravens/i.test(l.name));
  assert.ok(steelers && ravens);
  assert.equal(steelers.dk, 194);
  assert.ok(describeUnderdogOfferStaleWarning(steelers, now), "Steelers tick ~3h 50m old flags");
  assert.equal(describeUnderdogOfferStaleWarning(ravens, now), null, "Ravens minutes-old tick stays quiet");
  assert.ok(describePromoUnderdogStaleWarning([steelers], now));
  assert.equal(describePromoUnderdogStaleWarning([ravens], now), null);
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
  // Flag only — do not hide or de-rank cards from staleness.
  assert.doesNotMatch(app, /isUnderdogOddsStale\([^)]+\)\s*\?\s*null/);
  assert.doesNotMatch(app, /filter\(\s*\(.*stale/);
}

console.log("promoUnderdogFreshness.test.js ok");
