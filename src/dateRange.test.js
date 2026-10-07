import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isWithinDateRange, upcomingInRange } from "./dateRange.js";

const require = createRequire(import.meta.url);
const { isWithinDateRange: scannerRange } = require("../lib/promo-ev.js");

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");

// The old +EV "Today" check. Kept here so the fast path cannot drift.
function legacyRange(commence_time, range, now) {
  const ct = new Date(commence_time);
  if (range === "any") return true;
  if (range === "today") {
    const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const estCt = new Date(ct.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return estCt.toDateString() === estNow.toDateString();
  }
  if (range === "24h") return ct <= new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (range === "7d") return ct <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return true;
}

{
  const now = new Date("2026-10-07T18:00:00.000Z");
  const samples = [];
  for (let h = -36; h <= 200; h++) {
    samples.push(new Date(now.getTime() + h * 60 * 60 * 1000).toISOString());
  }
  samples.push("not-a-date", null, undefined, "");
  for (const range of ["today", "24h", "7d", "any", "nope"]) {
    for (const iso of samples) {
      const legacy = legacyRange(iso, range, now);
      assert.equal(isWithinDateRange(iso, range, now), legacy, `${range} ${iso}`);
      assert.equal(scannerRange(iso, range, now), legacy, `scanner ${range} ${iso}`);
    }
  }
  // ET midnight: 2026-10-08 00:00 EDT is 04:00Z. One minute earlier is still the 7th.
  const late = "2026-10-08T03:59:00.000Z";
  const early = "2026-10-08T04:00:00.000Z";
  assert.equal(isWithinDateRange(late, "today", now), true);
  assert.equal(isWithinDateRange(early, "today", now), false);
  assert.equal(legacyRange(late, "today", now), true);
  assert.equal(legacyRange(early, "today", now), false);
}

{
  const now = new Date("2026-10-07T18:00:00.000Z");
  const rows = [
    { sport: "baseball_mlb", commence_time: "2026-10-07T23:00:00.000Z", id: "today" },
    { sport: "baseball_mlb", commence_time: "2026-10-08T16:00:00.000Z", id: "tomorrow" },
    { sport: "baseball_mlb", commence_time: "2026-10-07T12:00:00.000Z", id: "started" },
    { sport: "icehockey_nhl", commence_time: "2026-10-07T23:30:00.000Z", id: "other-sport" },
  ];
  assert.deepEqual(upcomingInRange(rows, now, "today", ["baseball_mlb"]).map((g) => g.id), ["today"]);
  assert.deepEqual(upcomingInRange(rows, now, "any", null).map((g) => g.id), ["today", "tomorrow", "other-sport"]);
  assert.deepEqual(upcomingInRange(null, now, "today", null), []);
}

{
  const now = new Date();
  const times = [];
  for (let i = 0; i < 4000; i++) times.push(new Date(now.getTime() + i * 600000).toISOString());
  const t = performance.now();
  let hits = 0;
  for (let book = 0; book < 25; book++) {
    for (const iso of times) {
      if (isWithinDateRange(iso, "today", now)) hits++;
    }
  }
  const elapsed = performance.now() - t;
  assert.ok(hits > 0);
  assert.ok(elapsed < 400, `100k Today checks took ${Math.round(elapsed)}ms`);
}

{
  assert.match(app, /from "\.\/dateRange\.js"/);
  assert.doesNotMatch(app, /function isWithinDateRange/);
  assert.doesNotMatch(app, /toLocaleString\("en-US", \{ timeZone: "America\/New_York" \}\)/);
  const allBooks = app.slice(app.indexOf("function buildAllLegsAllBooks"), app.indexOf("function parlayLegKey"));
  assert.match(allBooks, /upcomingInRange\(data && data\.moneylines/);
  assert.doesNotMatch(allBooks, /isWithinDateRange\(/);
  assert.match(app, /initialAppTab\(window\.location\.hash\)/);
  assert.match(app, /shouldFetchFullBoard\(\{ tab: activeTab, fullBoardLoaded, forceRefresh: false \}\)/);
  assert.match(app, /shouldFetchPromoOdds\(\{ tab: activeTab, forceRefresh: false, promoLoaded \}\)/);
}

console.log("dateRange.test.js: ok");
