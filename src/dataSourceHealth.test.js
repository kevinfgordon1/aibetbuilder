import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STALE_CACHE_MS,
  isTimeoutError,
  isSupabaseDownError,
  isSupabaseUnhealthy,
  supabaseUnhealthyKind,
  describeSupabaseUnhealthy,
  staleCacheThresholdMs,
  cacheAgeMs,
  isCacheStale,
  formatUpdatedEt,
  describeCacheFreshness,
  dataSourceStatus,
  comboDeskErrorNote,
  comboDeskCatchNote,
  SUPABASE_FLAKY_CHIP,
} from "./dataSourceHealth.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

function timeoutErr(label = "odds_cache") {
  const err = new Error(`${label} timed out after 12000ms`);
  err.name = "TimeoutError";
  return err;
}

{
  assert.equal(isTimeoutError(timeoutErr()), true);
  assert.equal(isTimeoutError({ name: "AbortError", message: "aborted" }), true);
  assert.equal(isTimeoutError({ message: "timeout" }), true);
  assert.equal(isTimeoutError({ message: "jwt expired" }), false);
  assert.equal(isSupabaseDownError({ status: 522, message: "error code: 522" }), true);
  assert.equal(isSupabaseDownError({ status: "520", message: "error code: 520" }), true);
  assert.equal(isSupabaseDownError({ message: "Connection terminated due to connection timeout" }), true);
  assert.equal(isSupabaseDownError({ message: "Failed to fetch" }), true);
  assert.equal(isSupabaseDownError({ message: "429 rate limit" }), false);
  assert.equal(isSupabaseUnhealthy(timeoutErr()), true);
  assert.equal(isSupabaseUnhealthy({ status: 520, message: "error code: 520" }), true);
  assert.equal(isSupabaseUnhealthy({ message: "Invalid API key" }), false);
  assert.equal(supabaseUnhealthyKind({ status: 522 }), "down");
  assert.equal(supabaseUnhealthyKind(timeoutErr()), "timeout");
  assert.equal(supabaseUnhealthyKind({ message: "quota" }), null);
}

{
  const down = describeSupabaseUnhealthy({ status: 522, message: "error code: 522" }, { context: "odds" });
  assert.match(down, /Supabase \/ PostgREST/);
  assert.match(down, /not The Odds API quota/i);
  assert.doesNotMatch(down, /quota exceeded/i);
  const hung = describeSupabaseUnhealthy(timeoutErr(), { lastKnown: true, context: "odds" });
  assert.match(hung, /last loaded odds/i);
  assert.match(hung, /not The Odds API quota/i);
  const combo = describeSupabaseUnhealthy({ message: "timeout" }, { lastKnown: true, context: "combo" });
  assert.match(combo, /last known desk/i);
  assert.match(combo, /not Odds API quota/i);
  const comboFirst = describeSupabaseUnhealthy({ message: "timeout" }, { lastKnown: false, context: "combo" });
  assert.match(comboFirst, /Retrying/i);
  const uh = describeSupabaseUnhealthy({ message: "Failed to fetch" }, { context: "unhedged" });
  assert.match(uh, /Tape may be stale/i);
  assert.equal(describeSupabaseUnhealthy({ message: "jwt expired" }), null);
}

{
  const now = Date.parse("2026-09-08T18:00:00.000Z"); // 18 UTC → 5-min cron window
  assert.equal(STALE_CACHE_MS, 30 * 60 * 1000);
  assert.equal(staleCacheThresholdMs(now), STALE_CACHE_MS);
  const overnight = Date.parse("2026-09-08T08:00:00.000Z"); // 08 UTC hourly window
  assert.equal(staleCacheThresholdMs(overnight), 70 * 60 * 1000);
  assert.equal(cacheAgeMs("2026-09-08T17:40:00.000Z", now), 20 * 60 * 1000);
  assert.equal(isCacheStale("2026-09-08T17:50:00.000Z", now), false); // 10 min
  assert.equal(isCacheStale("2026-09-08T17:31:00.000Z", now), false); // 29 min — under 30
  assert.equal(isCacheStale("2026-09-08T17:30:00.000Z", now), true); // 30 min — warn
  assert.equal(isCacheStale("2026-09-08T17:20:00.000Z", now), true); // 40 min
  assert.equal(isCacheStale("2026-09-08T07:20:00.000Z", overnight), false); // 40 min in hourly window
  assert.equal(isCacheStale("2026-09-08T06:50:00.000Z", overnight), true); // 70 min overnight
  assert.equal(isCacheStale("2026-09-08T06:40:00.000Z", overnight), true); // 80 min
  assert.equal(isCacheStale(null, now), false);
}

{
  const fetchedAt = "2026-09-08T18:20:00.000-04:00";
  assert.match(formatUpdatedEt(fetchedAt), /^Updated \d{1,2}:\d{2} [AP]M ET$/);
  const freshNow = Date.parse("2026-09-08T18:25:00.000-04:00");
  const ok = describeCacheFreshness({ fetchedAt, now: freshNow });
  assert.equal(ok.show, true);
  assert.equal(ok.warn, false);
  assert.equal(ok.stale, false);
  assert.equal(ok.hint, null);
  assert.equal(ok.chip, null);
  assert.match(ok.label, /Updated /);

  const underStaleNow = Date.parse("2026-09-08T18:49:00.000-04:00"); // 29 min
  const stillFresh = describeCacheFreshness({ fetchedAt, now: underStaleNow });
  assert.equal(stillFresh.stale, false);
  assert.equal(stillFresh.warn, false);
  assert.equal(stillFresh.hint, null);
  assert.equal(stillFresh.chip, null);

  const staleNow = Date.parse("2026-09-08T18:50:00.000-04:00"); // 30 min
  const stale = describeCacheFreshness({ fetchedAt, now: staleNow });
  assert.equal(stale.stale, true);
  assert.equal(stale.warn, true);
  assert.equal(stale.hint, "Odds are out of date. Please refresh to use latest odds.");
  assert.doesNotMatch(stale.hint, /\/api\/fetch-odds|cache writer|cron|Supabase|PostgREST/i);
  assert.equal(stale.chip, "out of date");

  const failed = describeCacheFreshness({
    fetchedAt,
    now: freshNow,
    lastRefreshFailed: true,
    lastRefreshError: timeoutErr(),
  });
  assert.equal(failed.failed, true);
  assert.equal(failed.warn, true);
  assert.equal(failed.chip, SUPABASE_FLAKY_CHIP);
  assert.equal(failed.hint, "Last refresh failed. Please refresh to use latest odds.");
  assert.doesNotMatch(failed.hint, /Supabase|PostgREST|Odds API/i);
}

{
  const hidden = dataSourceStatus({ error: null });
  assert.equal(hidden.show, false);
  const quota = dataSourceStatus({ error: { message: "429 rate limit" } });
  assert.equal(quota.show, false);
  const down = dataSourceStatus({
    error: { status: 520, message: "error code: 520" },
    lastKnown: true,
    context: "odds",
  });
  assert.equal(down.show, true);
  assert.equal(down.chip, SUPABASE_FLAKY_CHIP);
  assert.match(down.title, /flaky/i);
  assert.match(down.message, /last loaded odds/i);
  assert.match(down.message, /not The Odds API quota/i);
}

{
  const jwt = comboDeskErrorNote({
    failed: true,
    bits: ["locks", "kill-switch"],
    hadReady: true,
    errors: [{ message: "jwt expired" }],
  });
  assert.match(jwt, /last known desk/);
  assert.doesNotMatch(jwt, /Supabase/);

  const flap = comboDeskErrorNote({
    failed: true,
    bits: ["locks", "kill-switch"],
    hadReady: true,
    errors: [{ message: "timeout" }],
  });
  assert.match(flap, /last known desk/);
  assert.match(flap, /Supabase \/ PostgREST/);
  assert.match(flap, /not Odds API quota/);

  const first = comboDeskCatchNote({ status: 522, message: "error code: 522" }, false);
  assert.match(first, /Retrying/);
  assert.match(first, /Supabase \/ PostgREST/);
  assert.equal(comboDeskErrorNote({ failed: false }), null);
}

{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /from "\.\/DataSourceStatus\.jsx"/);
  assert.match(app, /from "\.\/dataSourceHealth\.js"/);
  assert.match(app, /OddsUpdatedStamp/);
  assert.match(app, /DataSourceBanner/);
  assert.match(app, /describeCacheFreshness/);
  assert.match(app, /dataSourceStatus/);
  assert.match(app, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 30000\)/);
  assert.doesNotMatch(app, /\/api\/fetch-odds|\/api\/odds/);
  assert.match(app, /showOddsHealthBanner/);

  const combo = fs.readFileSync(path.join(dir, "ComboLocks.jsx"), "utf8");
  assert.match(combo, /DataSourceBanner/);
  assert.match(combo, /dataSourceStatus/);
  assert.match(combo, /comboDeskCatchNote/);
  assert.match(combo, /sourceUnhealthy/);
  assert.match(combo, /Supabase flaky/);

  const uh = fs.readFileSync(path.join(dir, "UnhedgedTape.jsx"), "utf8");
  assert.match(uh, /DataSourceBanner/);
  assert.match(uh, /dataSourceStatus/);
  assert.match(uh, /context: "unhedged"/);

  const odds = fs.readFileSync(path.join(dir, "oddsLoad.js"), "utf8");
  assert.match(odds, /from "\.\/dataSourceHealth\.js"/);
  assert.match(odds, /export \{ isSupabaseDownError/);
}

console.log("dataSourceHealth.test.js: ok");
