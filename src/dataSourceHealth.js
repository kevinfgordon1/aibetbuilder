// Shared "data source unhealthy" classification + copy.
// Promo / Odds Board / +EV read odds_cache; Combo Locks and Unhedged read
// other PostgREST tables. Same flap (timeout, Cloudflare 520/522, connection
// reset) should look like Supabase / PostgREST — never Odds API quota.

export const STALE_CACHE_MS = 30 * 60 * 1000;

const CF_ORIGIN_CODES = new Set([520, 521, 522, 523, 524, "520", "521", "522", "523", "524"]);

export function errorText(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return [err.message, err.details, err.hint, err.code].filter(Boolean).join(" ");
}

export function isTimeoutError(err) {
  if (!err) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  return /\btimed out\b|\btimeout\b|AbortError/i.test(errorText(err));
}

export function isSupabaseDownError(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? err.code;
  if (CF_ORIGIN_CODES.has(status)) return true;
  return /520|521|522|523|524|cloudflare|origin (is )?down|connection (terminated|timeout|reset|refused)|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Failed to fetch|fetch failed/i.test(
    errorText(err),
  );
}

export function isSupabaseUnhealthy(err) {
  return isTimeoutError(err) || isSupabaseDownError(err);
}

export function supabaseUnhealthyKind(err) {
  if (!err) return null;
  if (isSupabaseDownError(err)) return "down";
  if (isTimeoutError(err)) return "timeout";
  return null;
}

export const SUPABASE_FLAKY_CHIP = "Supabase flaky";
export const SUPABASE_NOT_QUOTA = "This is not The Odds API quota.";

export function describeSupabaseUnhealthy(err, { lastKnown = false, context = "odds" } = {}) {
  if (!isSupabaseUnhealthy(err)) return null;
  const kind = supabaseUnhealthyKind(err);
  const down = kind === "down";
  if (context === "combo") {
    const keep = lastKnown ? "Showing last known desk" : "Retrying";
    return down
      ? `Supabase / PostgREST is flaky or down (Cloudflare 520/522 or connection timeout). ${keep} — not Odds API quota.`
      : `Supabase / PostgREST timed out. ${keep} — not Odds API quota.`;
  }
  if (context === "unhedged") {
    return down
      ? "Supabase / PostgREST is flaky or down (Cloudflare 520/522 or connection timeout). Tape may be stale — not Odds API quota."
      : "Supabase / PostgREST timed out. Tape may be stale — not Odds API quota.";
  }
  if (lastKnown) {
    return down
      ? "Couldn't refresh the odds cache — Supabase / PostgREST is flaky or down (Cloudflare 520/522 or connection timeout). Showing last loaded odds. This is not The Odds API quota."
      : "Odds cache refresh timed out (Supabase / PostgREST). Showing last loaded odds. This is not The Odds API quota.";
  }
  return down
    ? "Couldn't reach the odds cache — Supabase / PostgREST is down (Cloudflare 520/522 or connection timeout). This is not The Odds API quota."
    : "Live odds timed out waiting for the odds cache (Supabase / PostgREST). This is not The Odds API quota — the cache request never finished.";
}

// fetch-odds cron: every 5 min most hours, hourly 07–10 UTC (overnight ET).
export function staleCacheThresholdMs(now = Date.now()) {
  const h = new Date(now).getUTCHours();
  if (h >= 7 && h <= 10) return 70 * 60 * 1000;
  return STALE_CACHE_MS;
}

export function cacheAgeMs(fetchedAt, now = Date.now()) {
  if (!fetchedAt) return null;
  const t = typeof fetchedAt === "number" ? fetchedAt : Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

export function isCacheStale(fetchedAt, now = Date.now(), thresholdMs) {
  const age = cacheAgeMs(fetchedAt, now);
  if (age == null) return false;
  return age >= (thresholdMs != null ? thresholdMs : staleCacheThresholdMs(now));
}

export function formatUpdatedEt(fetchedAt) {
  if (!fetchedAt) return null;
  const d = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `Updated ${time} ET`;
}

export function describeCacheFreshness({
  fetchedAt,
  now = Date.now(),
  lastRefreshFailed = false,
  lastRefreshError = null,
} = {}) {
  const label = formatUpdatedEt(fetchedAt);
  if (!label) {
    return {
      show: false,
      label: null,
      stale: false,
      failed: !!lastRefreshFailed,
      warn: !!lastRefreshFailed,
      hint: null,
      chip: lastRefreshFailed && isSupabaseUnhealthy(lastRefreshError) ? SUPABASE_FLAKY_CHIP : null,
    };
  }
  const stale = isCacheStale(fetchedAt, now);
  const failed = !!lastRefreshFailed;
  const unhealthy = isSupabaseUnhealthy(lastRefreshError);
  let hint = null;
  if (failed) {
    hint = "Last refresh failed. Please refresh to use latest odds.";
  } else if (stale) {
    hint = "Odds are out of date. Please refresh to use latest odds.";
  }
  let chip = null;
  if (failed && unhealthy) chip = SUPABASE_FLAKY_CHIP;
  else if (stale) chip = "out of date";
  return {
    show: true,
    label,
    stale,
    failed,
    warn: stale || failed,
    hint,
    chip,
  };
}

export function dataSourceStatus({
  error,
  fetchedAt,
  now = Date.now(),
  lastKnown = false,
  context = "odds",
} = {}) {
  if (!isSupabaseUnhealthy(error)) {
    return { show: false, tone: "ok", chip: null, title: null, message: null, kind: null };
  }
  const kind = supabaseUnhealthyKind(error);
  const message = describeSupabaseUnhealthy(error, { lastKnown, context });
  const title = lastKnown
    ? "Supabase / PostgREST is flaky — showing last known data"
    : "Supabase / PostgREST is flaky or down";
  return {
    show: true,
    tone: "warn",
    chip: SUPABASE_FLAKY_CHIP,
    title,
    message,
    kind,
    stale: isCacheStale(fetchedAt, now),
  };
}

export function comboDeskErrorNote({ failed, bits, hadReady, errors = [] } = {}) {
  if (!failed) return null;
  const names = (bits && bits.length) ? bits : ["locks / kill-switch"];
  const base = hadReady
    ? `Couldn't refresh ${names.join(" / ")} — showing last known desk.`
    : `Couldn't load ${names.join(" / ")}. Retrying…`;
  if (!errors.some(isSupabaseUnhealthy)) return base;
  return `${base} Supabase / PostgREST is flaky or down — not Odds API quota.`;
}

export function comboDeskCatchNote(err, hadReady) {
  return comboDeskErrorNote({
    failed: true,
    bits: ["locks", "kill-switch"],
    hadReady: !!hadReady,
    errors: err ? [err] : [],
  });
}
