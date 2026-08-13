const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SCAN_INTERVAL_MS,
  WORKER_ODDS_CACHE_TIMEOUT_MS,
  WORKER_OPTIONAL_TABLE_TIMEOUT_MS,
  WORKER_SCAN_TIME_BUDGET_MS,
  parsePositiveMs,
  scanIntervalMs,
  oddsCacheTimeoutMs,
  optionalTableTimeoutMs,
  scanTimeBudgetMs,
  requiredEnvPresent,
  runOnce,
} = require("./ev-parlay-alerts");

const future = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

function mkScanGame(away, home, dkAway, dkHome, fdAway, fdHome) {
  return {
    commence_time: future,
    away_team: away,
    home_team: home,
    bookmakers: [
      { key: "draftkings", markets: [{ key: "h2h", outcomes: [{ name: away, price: dkAway }, { name: home, price: dkHome }] }] },
      { key: "fanduel", markets: [{ key: "h2h", outcomes: [{ name: away, price: fdAway }, { name: home, price: fdHome }] }] },
    ],
  };
}

function mlbPlusEvSlate() {
  return [
    mkScanGame("Alpha", "Beta", 150, -130, -180, 160),
    mkScanGame("Gamma", "Delta", 140, -125, -175, 155),
    mkScanGame("Epsilon", "Zeta", 145, -128, -170, 150),
    mkScanGame("Eta", "Theta", -175, 155, 148, -132),
    mkScanGame("Iota", "Kappa", -172, 152, 142, -126),
    mkScanGame("Lambda", "Mu", -168, 148, 138, -122),
  ];
}

function hang(signal) {
  return new Promise((_, reject) => {
    const onAbort = () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (!signal) return;
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function main() {
  const origLog = console.log;
  const origError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    await run();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  console.log("ev-parlay-alerts.test.js ok");
}

async function run() {
  assert.equal(DEFAULT_SCAN_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(WORKER_ODDS_CACHE_TIMEOUT_MS, 120000);
  assert.ok(WORKER_OPTIONAL_TABLE_TIMEOUT_MS >= 5000 && WORKER_OPTIONAL_TABLE_TIMEOUT_MS <= 10000);
  assert.ok(WORKER_SCAN_TIME_BUDGET_MS >= 120000, "worker scan budget is minutes, not Vercel 45s");
  assert.ok(WORKER_ODDS_CACHE_TIMEOUT_MS > 25000, "worker must not use the 25s Vercel cap");

  assert.equal(parsePositiveMs(undefined, 9), 9);
  assert.equal(parsePositiveMs("abc", 9), 9);
  assert.equal(parsePositiveMs("500", 9), 9); // below 1s floor
  assert.equal(parsePositiveMs("1500", 9), 1500);
  assert.equal(parsePositiveMs("120000", 9), 120000);

  assert.equal(scanIntervalMs({}), DEFAULT_SCAN_INTERVAL_MS);
  assert.equal(scanIntervalMs({ EV_SCAN_INTERVAL_MS: "30000" }), 30000);
  assert.equal(oddsCacheTimeoutMs({}), WORKER_ODDS_CACHE_TIMEOUT_MS);
  assert.equal(oddsCacheTimeoutMs({ EV_ODDS_CACHE_TIMEOUT_MS: "180000" }), 180000);
  assert.equal(optionalTableTimeoutMs({}), WORKER_OPTIONAL_TABLE_TIMEOUT_MS);
  assert.equal(optionalTableTimeoutMs({ EV_OPTIONAL_TABLE_TIMEOUT_MS: "10000" }), 10000);
  assert.equal(scanTimeBudgetMs({}), WORKER_SCAN_TIME_BUDGET_MS);

  assert.equal(requiredEnvPresent({}), false);
  assert.equal(requiredEnvPresent({ SUPABASE_URL: "https://x.supabase.co" }), false);
  assert.equal(requiredEnvPresent({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_KEY: "svc",
  }), true);

  // ── runOnce logs elapsedMs and uses worker timeouts, not Vercel 25s
  {
    const queriedTimeouts = [];
    const result = await runOnce({
      skipTelegram: true,
      oddsCacheTimeoutMs: 40,
      queryOddsCache: (_sport, signal) => {
        queriedTimeouts.push(true);
        return hang(signal);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 504);
    assert.ok(typeof result.elapsedMs === "number");
    assert.ok(result.elapsedMs < 500);
    assert.equal(queriedTimeouts.length, 1);
    assert.match(String(result.payload.error), /timed out after 40ms/);
  }

  {
    const result = await runOnce({
      skipTelegram: true,
      queryOddsCache: async (sport) => ({
        data: { sport, data: mlbPlusEvSlate(), fetched_at: "t" },
        error: null,
      }),
    });
    assert.equal(result.ok, true);
    assert.ok(result.payload.comboCount > 0);
    assert.ok(result.payload.candidates >= 1);
    assert.ok(typeof result.elapsedMs === "number");
    assert.deepEqual(result.payload.loadedSports, ["baseball_mlb"]);
    assert.equal(result.payload.skippedTelegram, "debug");
  }

  // ── source: Railway isolation, no Vercel HTTP, no KayGo token, no Combo Locks
  {
    const workerSrc = fs.readFileSync(path.join(__dirname, "./ev-parlay-alerts.js"), "utf8");
    const vercelSrc = fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8");
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
    const comboSrc = fs.readFileSync(path.join(__dirname, "../src/ComboLocks.jsx"), "utf8");
    const kaygoSrc = fs.readFileSync(path.join(__dirname, "../api/telegram-webhook.js"), "utf8");

    assert.equal(pkg.scripts["ev-alerts"], "node worker/ev-parlay-alerts.js");
    assert.ok(pkg.scripts.test.includes("worker/ev-parlay-alerts.test.js"));

    assert.ok(workerSrc.includes("runEvParlayScan"));
    assert.ok(workerSrc.includes("EV_SCAN_INTERVAL_MS"));
    assert.ok(workerSrc.includes("EV_ODDS_CACHE_TIMEOUT_MS"));
    assert.match(workerSrc, /WORKER_ODDS_CACHE_TIMEOUT_MS = 120000/);
    assert.match(workerSrc, /DEFAULT_SCAN_INTERVAL_MS = 10 \* 60 \* 1000/);
    assert.ok(workerSrc.includes("elapsedMs"));
    assert.ok(workerSrc.includes("sleeping"));
    assert.ok(!workerSrc.includes("fetch('https://"));
    assert.ok(!workerSrc.includes("/api/scan-ev-parlays"));
    assert.ok(!workerSrc.includes("process.env.TELEGRAM_BOT_TOKEN"));
    assert.ok(!workerSrc.includes("EV_ALERT_TELEGRAM_BOT_TOKEN"));
    assert.ok(workerSrc.includes("EVparlays_alert_telegram_bot_token"));
    assert.ok(workerSrc.includes("8745205056"));
    assert.ok(workerSrc.includes("require.main === module"));

    const vercel = JSON.parse(vercelSrc);
    assert.ok(!vercel.crons.some(c => String(c.path || "").includes("scan-ev-parlays")));
    assert.ok(!comboSrc.includes("ev-parlay"));
    assert.ok(!comboSrc.includes("scan-ev-parlays"));
    assert.ok(kaygoSrc.includes("TELEGRAM_BOT_TOKEN"));
    assert.ok(!kaygoSrc.includes("runEvParlayScan"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
