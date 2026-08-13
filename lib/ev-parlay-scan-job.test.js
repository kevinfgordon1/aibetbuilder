const assert = require("node:assert/strict");
const { runEvParlayScan } = require("./ev-parlay-scan-job");
const { KEVIN_EV_ALERT_CHAT_ID } = require("./ev-parlay-alert");

const future = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

function mkScanGame(away, home, dkAway, dkHome, fdAway, fdHome, commence_time = future) {
  return {
    commence_time,
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
  console.log("ev-parlay-scan-job.test.js ok");
}

async function run() {
  // ── skipTelegram: scan only, no send
  {
    const result = await runEvParlayScan({
      skipTelegram: true,
      oddsCacheTimeoutMs: 200,
      queryOddsCache: async (sport) => ({
        data: { sport, data: mlbPlusEvSlate(), fetched_at: "t" },
        error: null,
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.payload.skippedTelegram, "debug");
    assert.ok(result.payload.comboCount > 0);
    assert.ok(result.payload.candidates >= 1);
    assert.ok(typeof result.elapsedMs === "number");
    assert.deepEqual(result.payload.loadedSports, ["baseball_mlb"]);
  }

  // ── send-before-dedup with Kevin fallback; upsert after send
  {
    const order = [];
    const result = await runEvParlayScan({
      oddsCacheTimeoutMs: 200,
      optionalTableTimeoutMs: 200,
      token: "test-token",
      envChatId: "",
      queryOddsCache: async (sport) => ({
        data: { sport, data: mlbPlusEvSlate(), fetched_at: "t" },
        error: null,
      }),
      loadChatRows: async () => ({ data: [], error: null }),
      loadExistingRows: async () => ({ data: [], error: null }),
      sendTelegramFn: async (_token, chatId, text) => {
        order.push("send");
        assert.equal(chatId, KEVIN_EV_ALERT_CHAT_ID);
        assert.match(text, /\+EV 3-leg/);
        return { ok: true, status: 200, body: { ok: true } };
      },
      recordAlerts: async (toAlert) => {
        order.push("upsert");
        assert.ok(toAlert.length >= 1);
        return { data: null, error: null };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.sentSuccessfully, true);
    assert.ok(result.payload.alerted >= 1);
    assert.equal(result.payload.recipients, 1);
    assert.deepEqual(order, ["send", "upsert"]);
    assert.deepEqual(result.payload.loadedSports, ["baseball_mlb"]);
    assert.ok(typeof result.elapsedMs === "number");
  }

  // ── odds_cache hang uses caller timeout (Railway 120s cap is injectable)
  {
    const t0 = Date.now();
    const result = await runEvParlayScan({
      oddsCacheTimeoutMs: 40,
      queryOddsCache: (_sport, signal) => hang(signal),
    });
    assert.ok(Date.now() - t0 < 500);
    assert.equal(result.ok, false);
    assert.equal(result.status, 504);
    assert.equal(result.payload.timedOut, true);
    assert.deepEqual(result.payload.timedOutSports, ["baseball_mlb"]);
    assert.ok(result.elapsedMs < 500);
    assert.match(String(result.payload.error), /timed out after 40ms/);
  }

  // ── hydrate path: NFL rows are not loaded because SCAN_SPORT_KEYS is MLB
  {
    const queried = [];
    await runEvParlayScan({
      skipTelegram: true,
      oddsCacheTimeoutMs: 200,
      queryOddsCache: async (sport) => {
        queried.push(sport);
        return { data: { sport, data: mlbPlusEvSlate(), fetched_at: "t" }, error: null };
      },
    });
    assert.deepEqual(queried, ["baseball_mlb"]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
