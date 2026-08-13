const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  OPTIONAL_TABLE_TIMEOUT_MS,
  ODDS_CACHE_TIMEOUT_MS,
  ODDS_CACHE_COLUMNS,
  runOptional,
  runRequired,
  loadOddsCacheBySport,
  skipTelegramRequested,
  deliverEvParlayAlerts,
  alertRowsForUpsert,
  sendTelegram,
} = require("./ev-parlay-scan-flow");
const { KEVIN_EV_ALERT_CHAT_ID } = require("./ev-parlay-alert");

const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

function parlay(fp, evPct = 3.5) {
  return {
    fingerprint: fp,
    bookKey: "draftkings",
    bookLabel: "DraftKings",
    ev: evPct,
    evPct,
    combinedProb: 0.2,
    parlayOdds: 650,
    legs: [
      { name: "Yankees ML", game: "Yankees @ Red Sox", sport: "baseball_mlb", dk: -120, market: "ML", commence_time: future },
      { name: "Cubs ML", game: "Cubs @ Brewers", sport: "baseball_mlb", dk: 110, market: "ML", commence_time: future },
      { name: "Dodgers ML", game: "Dodgers @ Giants", sport: "baseball_mlb", dk: 130, market: "ML", commence_time: future },
    ],
  };
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
  const origError = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    console.error = origError;
  }
  console.log("ev-parlay-scan-flow.test.js ok");
}

async function run() {
  // ── runOptional: hang/timeout becomes empty rows, not a throw
  {
    const t0 = Date.now();
    const out = await runOptional(signal => hang(signal), { timeoutMs: 40, label: "hang-test" });
    assert.ok(Date.now() - t0 < 500, "timeout must not wait on the hanging query");
    assert.deepEqual(out.data, []);
    assert.equal(out.timedOut, true);
    assert.ok(out.error);
  }

  {
    const out = await runOptional(async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }), {
      timeoutMs: 200,
      label: "pg-timeout",
    });
    assert.deepEqual(out.data, []);
    assert.equal(out.timedOut, false);
    assert.equal(out.error.message, "canceling statement due to statement timeout");
  }

  {
    const out = await runOptional(async () => { throw new Error("relation ev_parlay_alerts does not exist"); }, {
      timeoutMs: 200,
      label: "missing-table",
    });
    assert.deepEqual(out.data, []);
    assert.match(String(out.error.message), /does not exist/);
  }

  {
    const ctrlAborted = [];
    const out = await runOptional(async (signal) => {
      signal.addEventListener("abort", () => ctrlAborted.push(true));
      return hang(signal);
    }, { timeoutMs: 30, label: "abort" });
    assert.equal(out.timedOut, true);
    assert.equal(ctrlAborted.length, 1);
  }

  {
    const out = await runOptional(async () => ({ data: [{ telegram_chat_id: "1" }], error: null }), {
      timeoutMs: 200,
      label: "ok",
    });
    assert.deepEqual(out.data, [{ telegram_chat_id: "1" }]);
    assert.equal(out.error, null);
    assert.equal(out.timedOut, false);
  }

  assert.equal(OPTIONAL_TABLE_TIMEOUT_MS, 2000);
  assert.equal(ODDS_CACHE_TIMEOUT_MS, 8000);
  assert.equal(ODDS_CACHE_COLUMNS, "sport,data,fetched_at");

  // ── runRequired: hang → 504 immediately (do not wait maxDuration)
  {
    const t0 = Date.now();
    const out = await runRequired(signal => hang(signal), { timeoutMs: 40, label: "odds_cache" });
    assert.ok(Date.now() - t0 < 500, "required timeout must not wait on the hanging query");
    assert.equal(out.ok, false);
    assert.equal(out.status, 504);
    assert.equal(out.timedOut, true);
    assert.match(String(out.message), /timed out/);
  }

  {
    const out = await runRequired(async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }), {
      timeoutMs: 200,
      label: "odds_cache",
    });
    assert.equal(out.ok, false);
    assert.equal(out.status, 500);
    assert.equal(out.timedOut, false);
    assert.match(String(out.message), /statement timeout/);
  }

  {
    const out = await runRequired(async () => ({ data: [{ sport: "baseball_mlb", data: [] }], error: null }), {
      timeoutMs: 200,
      label: "odds_cache",
    });
    assert.equal(out.ok, true);
    assert.equal(out.status, 200);
    assert.equal(out.data[0].sport, "baseball_mlb");
  }

  // ── per-sport odds_cache: skip timeouts, 504 only if none load
  {
    const origLog = console.log;
    console.log = () => {};
    try {
      const queried = [];
      const out = await loadOddsCacheBySport(
        ["baseball_mlb", "basketball_nba", "icehockey_nhl"],
        async (sport, signal) => {
          queried.push(sport);
          if (sport === "basketball_nba") return hang(signal);
          return { data: { sport, data: [{ id: sport }], fetched_at: "t" }, error: null };
        },
        { timeoutMs: 40 }
      );
      assert.deepEqual(queried, ["baseball_mlb", "basketball_nba", "icehockey_nhl"]);
      assert.equal(out.ok, true);
      assert.equal(out.status, 200);
      assert.deepEqual(out.loadedSports, ["baseball_mlb", "icehockey_nhl"]);
      assert.deepEqual(out.timedOutSports, ["basketball_nba"]);
      assert.deepEqual(out.errorSports, []);
      assert.equal(out.data.length, 2);
      assert.equal(out.data[0].sport, "baseball_mlb");
      assert.equal(out.data[1].sport, "icehockey_nhl");
    } finally {
      console.log = origLog;
    }
  }

  {
    const origLog = console.log;
    console.log = () => {};
    try {
      const t0 = Date.now();
      const out = await loadOddsCacheBySport(
        ["baseball_mlb", "basketball_nba"],
        (_sport, signal) => hang(signal),
        { timeoutMs: 40 }
      );
      assert.ok(Date.now() - t0 < 500, "all-sport timeout must not hang");
      assert.equal(out.ok, false);
      assert.equal(out.status, 504);
      assert.equal(out.timedOut, true);
      assert.deepEqual(out.loadedSports, []);
      assert.deepEqual(out.timedOutSports, ["baseball_mlb", "basketball_nba"]);
      assert.match(String(out.message), /timed out/);
    } finally {
      console.log = origLog;
    }
  }

  {
    const origLog = console.log;
    console.log = () => {};
    try {
      const out = await loadOddsCacheBySport(
        ["baseball_mlb", "basketball_nba"],
        async (sport) => {
          if (sport === "baseball_mlb") {
            return { data: null, error: { message: "permission denied" } };
          }
          return { data: { sport, data: [], fetched_at: "t" }, error: null };
        },
        { timeoutMs: 200 }
      );
      assert.equal(out.ok, true);
      assert.deepEqual(out.loadedSports, ["basketball_nba"]);
      assert.deepEqual(out.errorSports, ["baseball_mlb"]);
      assert.deepEqual(out.timedOutSports, []);
    } finally {
      console.log = origLog;
    }
  }

  {
    const origLog = console.log;
    console.log = () => {};
    try {
      const out = await loadOddsCacheBySport(
        ["baseball_mlb"],
        async () => ({ data: null, error: { message: "permission denied" } }),
        { timeoutMs: 200 }
      );
      assert.equal(out.ok, false);
      assert.equal(out.status, 504);
      assert.deepEqual(out.errorSports, ["baseball_mlb"]);
      assert.deepEqual(out.loadedSports, []);
    } finally {
      console.log = origLog;
    }
  }

  {
    const origLog = console.log;
    console.log = () => {};
    try {
      const out = await loadOddsCacheBySport(
        ["baseball_mlb", "basketball_nba"],
        async () => ({ data: null, error: null }),
        { timeoutMs: 200 }
      );
      assert.equal(out.ok, true);
      assert.deepEqual(out.loadedSports, ["baseball_mlb", "basketball_nba"]);
      assert.deepEqual(out.data, []);
      assert.deepEqual(out.timedOutSports, []);
    } finally {
      console.log = origLog;
    }
  }

  // ── ?skipTelegram=1 is a cheap debug flag
  {
    assert.equal(skipTelegramRequested({ query: { skipTelegram: "1" } }), true);
    assert.equal(skipTelegramRequested({ query: { skipTelegram: "true" } }), true);
    assert.equal(skipTelegramRequested({ url: "/api/scan-ev-parlays?skipTelegram=1" }), true);
    assert.equal(skipTelegramRequested({ url: "/api/scan-ev-parlays?skipTelegram=true" }), true);
    assert.equal(skipTelegramRequested({ url: "/api/scan-ev-parlays" }), false);
    assert.equal(skipTelegramRequested({}), false);
  }

  // ── hanging ev_alert_chats still sends to Kevin fallback, then upserts
  {
    const order = [];
    const delivered = await deliverEvParlayAlerts({
      parlays: [parlay("fp-a")],
      token: "test-token",
      envChatId: "",
      loadChatRows: signal => hang(signal),
      loadExistingRows: (_fp, signal) => hang(signal),
      sendTelegramFn: async (token, chatId, text) => {
        order.push("send");
        assert.equal(token, "test-token");
        assert.equal(chatId, KEVIN_EV_ALERT_CHAT_ID);
        assert.match(text, /Yankees ML/);
        return { ok: true, status: 200, body: { ok: true } };
      },
      recordAlerts: async (toAlert) => {
        order.push("upsert");
        assert.equal(toAlert.length, 1);
        return { data: null, error: null };
      },
      timeoutMs: 40,
    });
    assert.equal(delivered.sent, true);
    assert.equal(delivered.alerted, 1);
    assert.equal(delivered.recipients, 1);
    assert.equal(delivered.skippedTelegram, undefined);
    assert.deepEqual(order, ["send", "upsert"]);
    assert.equal(delivered.chatsTimedOut, true);
    assert.equal(delivered.existingTimedOut, true);
  }

  // ── missing tables (error objects) still send via Kevin fallback
  {
    const delivered = await deliverEvParlayAlerts({
      parlays: [parlay("fp-b")],
      token: "tok",
      envChatId: "",
      loadChatRows: async () => ({ data: null, error: { message: "relation ev_alert_chats does not exist" } }),
      loadExistingRows: async () => ({ data: null, error: { message: "relation ev_parlay_alerts does not exist" } }),
      sendTelegramFn: async (_t, chatId) => {
        assert.equal(chatId, KEVIN_EV_ALERT_CHAT_ID);
        return { ok: true, status: 200, body: { ok: true } };
      },
      recordAlerts: async () => ({ data: null, error: { message: "relation ev_parlay_alerts does not exist" } }),
      timeoutMs: 200,
    });
    assert.equal(delivered.sent, true);
    assert.equal(delivered.alerted, 1);
    assert.equal(delivered.recipients, 1);
    assert.equal(delivered.dedupWriteError, true);
  }

  // ── hanging upsert after a successful send still returns alerted
  {
    const t0 = Date.now();
    const delivered = await deliverEvParlayAlerts({
      parlays: [parlay("fp-c")],
      token: "tok",
      envChatId: "111",
      loadChatRows: async () => ({ data: [], error: null }),
      sendTelegramFn: async () => ({ ok: true, status: 200, body: { ok: true } }),
      recordAlerts: (_toAlert, signal) => hang(signal),
      timeoutMs: 40,
    });
    assert.ok(Date.now() - t0 < 500);
    assert.equal(delivered.sent, true);
    assert.equal(delivered.alerted, 1);
    assert.equal(delivered.recipients, 1);
    assert.equal(delivered.dedupWriteTimedOut, true);
  }

  // ── telegram HTTP error body is returned; token is not
  {
    const delivered = await deliverEvParlayAlerts({
      parlays: [parlay("fp-d")],
      token: "super-secret-bot-token",
      envChatId: "111",
      sendTelegramFn: async () => ({
        ok: false,
        status: 401,
        body: { ok: false, error_code: 401, description: "Unauthorized" },
      }),
      timeoutMs: 200,
    });
    assert.equal(delivered.sent, false);
    assert.equal(delivered.alerted, 0);
    assert.equal(delivered.recipients, 1);
    assert.deepEqual(delivered.telegramError.body, {
      ok: false,
      error_code: 401,
      description: "Unauthorized",
    });
    assert.equal(delivered.telegramError.status, 401);
    const dumped = JSON.stringify(delivered);
    assert.ok(!dumped.includes("super-secret-bot-token"));
  }

  // ── sendTelegram itself never puts the token URL on the result
  {
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: "Bad Request: chat not found" }),
      };
    };
    const sent = await sendTelegram("secret-token-value", "8745205056", "hi", fakeFetch);
    assert.equal(sent.ok, false);
    assert.equal(sent.status, 400);
    assert.equal(sent.body.description, "Bad Request: chat not found");
    assert.ok(calls[0].url.includes("secret-token-value"));
    assert.ok(!JSON.stringify(sent).includes("secret-token-value"));
  }

  // ── healthy dedup read still suppresses a recent duplicate
  {
    let sent = 0;
    const delivered = await deliverEvParlayAlerts({
      parlays: [parlay("fp-e", 3.2)],
      token: "tok",
      envChatId: "111",
      loadExistingRows: async () => ({
        data: [{ fingerprint: "fp-e", ev_pct: 3.2, sent_at: new Date().toISOString() }],
        error: null,
      }),
      sendTelegramFn: async () => {
        sent += 1;
        return { ok: true, status: 200, body: { ok: true } };
      },
      timeoutMs: 200,
    });
    assert.equal(sent, 0);
    assert.equal(delivered.toAlert, 0);
    assert.equal(delivered.alerted, 0);
  }

  // ── missing token skips send
  {
    const delivered = await deliverEvParlayAlerts({
      parlays: [parlay("fp-f")],
      token: "",
      envChatId: "111",
      sendTelegramFn: async () => { throw new Error("should not send"); },
    });
    assert.equal(delivered.skippedTelegram, "missing_token");
    assert.equal(delivered.alerted, 0);
  }

  // ── upsert payload shape
  {
    const rows = alertRowsForUpsert([parlay("fp-g")], "2026-08-13T18:00:00.000Z");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fingerprint, "fp-g");
    assert.equal(rows[0].book_key, "draftkings");
    assert.equal(rows[0].sent_at, "2026-08-13T18:00:00.000Z");
    assert.equal(rows[0].legs.length, 3);
  }

  // ── handler source: send-first flow, no KayGo token
  {
    const scanSrc = fs.readFileSync(path.join(__dirname, "../api/scan-ev-parlays.js"), "utf8");
    const flowSrc = fs.readFileSync(path.join(__dirname, "./ev-parlay-scan-flow.js"), "utf8");
    assert.ok(scanSrc.includes("deliverEvParlayAlerts"));
    assert.ok(scanSrc.includes("errorAfterSend"));
    assert.ok(scanSrc.includes("loadOddsCacheBySport"));
    assert.ok(scanSrc.includes("SCAN_SPORT_KEYS"));
    assert.ok(scanSrc.includes("ODDS_CACHE_TIMEOUT_MS"));
    assert.ok(scanSrc.includes("ODDS_CACHE_COLUMNS"));
    assert.ok(scanSrc.includes("skipTelegramRequested"));
    assert.ok(scanSrc.includes(".eq('sport', sport)"));
    assert.ok(scanSrc.includes("maybeSingle()"));
    assert.ok(!/\bSPORT_KEYS\b/.test(scanSrc));
    assert.ok(!scanSrc.includes("americanfootball_nfl"));
    assert.ok(!scanSrc.includes("basketball_nba"));
    assert.ok(!scanSrc.includes(".in('sport'"));
    assert.ok(!scanSrc.includes('.in("sport"'));
    assert.ok(!scanSrc.includes(".select('*')"));
    assert.ok(!scanSrc.includes('.select("*")'));
    assert.ok(flowSrc.includes("OPTIONAL_TABLE_TIMEOUT_MS"));
    assert.ok(flowSrc.includes("ODDS_CACHE_TIMEOUT_MS"));
    assert.ok(flowSrc.includes("loadOddsCacheBySport"));
    assert.ok(flowSrc.includes("applyAbortSignal"));
    assert.ok(!scanSrc.includes("process.env.TELEGRAM_BOT_TOKEN"));
    assert.ok(!flowSrc.includes("process.env.TELEGRAM_BOT_TOKEN"));
    assert.ok(!scanSrc.includes("EV_ALERT_TELEGRAM_BOT_TOKEN"));
    assert.ok(!flowSrc.includes("EV_ALERT_TELEGRAM_BOT_TOKEN"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
