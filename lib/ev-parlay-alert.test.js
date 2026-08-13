const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  parlayFingerprint,
  shouldRealert,
  selectNewAlerts,
  formatAlertMessage,
  formatParlayBlock,
  scanBooksForEvParlays,
  findMain3LegHits,
  DEDUP_WINDOW_MS,
  KEVIN_EV_ALERT_CHAT_ID,
  mergeEvAlertChatIds,
} = require("./ev-parlay-alert");
const { calcParlayEV, evPct, passesEvThreshold, hydrateFeaturedOdds } = require("./promo-ev");
const {
  EV_PARLAYS_BOT_TOKEN_ENV,
  resolveEvParlaysBotToken,
  evParlaysBotToken,
} = require("./ev-parlays-bot-token");

const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

function leg(name, game, sport, dk, bestOpp) {
  return { name, game, sport, dk, bestOpp, commence_time: future, market: "ML" };
}

// ── fingerprint includes book key + sorted names + sport
{
  const legs = [
    leg("Cubs ML", "Cubs @ Brewers", "baseball_mlb", 100, -110),
    leg("Yankees ML", "Yankees @ Red Sox", "baseball_mlb", -120, 110),
    leg("Dodgers ML", "Dodgers @ Giants", "baseball_mlb", 130, -140),
  ];
  const dk = parlayFingerprint("draftkings", legs);
  const fd = parlayFingerprint("fanduel", legs);
  assert.match(dk, /^draftkings::/);
  assert.match(fd, /^fanduel::/);
  assert.notEqual(dk, fd, "same three teams at two books must both be able to alert");
  assert.ok(dk.includes("Cubs ML") && dk.includes("Dodgers ML") && dk.includes("Yankees ML"));
  // names sorted
  const namesPart = dk.split("::")[2];
  assert.equal(namesPart, "Cubs ML|Dodgers ML|Yankees ML");
  assert.ok(dk.includes("baseball_mlb"));
}

// ── dedup: skip within 6h unless EV jumped ≥ 1pp
{
  const now = Date.parse("2026-08-13T18:00:00Z");
  const hourAgo = { sent_at: "2026-08-13T17:00:00Z", ev_pct: 3.0 };
  const sevenHoursAgo = { sent_at: "2026-08-13T11:00:00Z", ev_pct: 3.0 };
  assert.equal(shouldRealert(null, 3.5, { nowMs: now }), true);
  assert.equal(shouldRealert(hourAgo, 3.2, { nowMs: now }), false);
  assert.equal(shouldRealert(hourAgo, 4.0, { nowMs: now }), true); // +1.0 jump
  assert.equal(shouldRealert(hourAgo, 3.9, { nowMs: now }), false); // +0.9 no
  assert.equal(shouldRealert(sevenHoursAgo, 3.0, { nowMs: now }), true);
  assert.equal(DEDUP_WINDOW_MS, 6 * 60 * 60 * 1000);
}

// ── selectNewAlerts: highest-EV first (input already ranked), cap 5, skip recent dupes
{
  const parlays = [3.1, 2.9, 2.5, 2.4, 2.3, 2.2, 2.1].map((pct, i) => ({
    fingerprint: `fp${i}`,
    ev: pct,
    evPct: pct,
  }));
  const existing = {
    fp0: { sent_at: new Date().toISOString(), ev_pct: 3.1 },
    fp1: { sent_at: new Date().toISOString(), ev_pct: 2.9 },
  };
  const picked = selectNewAlerts(parlays, existing, { alertMax: 5, nowMs: Date.now() });
  assert.equal(picked.length, 5);
  assert.deepEqual(picked.map(p => p.fingerprint), ["fp2", "fp3", "fp4", "fp5", "fp6"]);
}

// ── Telegram copy names the sportsbook (not always DK)
{
  const hit = {
    bookKey: "fanduel",
    bookLabel: "FanDuel",
    ev: 4.5,
    evPct: 4.5,
    combinedProb: 0.2,
    parlayOdds: 650,
    legs: [
      leg("Yankees ML", "Yankees @ Red Sox", "baseball_mlb", -120, 105),
      leg("Cubs ML", "Cubs @ Brewers", "baseball_mlb", 110, -125),
      leg("Dodgers ML", "Dodgers @ Giants", "baseball_mlb", 130, -140),
    ],
  };
  const block = formatParlayBlock(hit, 100);
  assert.match(block, /\+EV 3-leg \(0% boost, \$100 FanDuel\)/);
  assert.match(block, /EV \+\$4\.50 \(4\.5%\)/);
  assert.match(block, /Yankees ML/);
  assert.match(block, /FanDuel parlay \+650/);
  assert.match(block, / ET/);
  const msg = formatAlertMessage([hit], 100);
  assert.match(msg, /https:\/\/www\.aibetbuilder\.io\//);
}

// ── 3-leg search skips same game and respects EV% > 2
{
  const cheap = { dk: 100, bestOpp: 200 }; // ourTrueProb(200) = 1 - 100/300 = 0.666..., +EV
  const juice = { dk: -200, bestOpp: -110 }; // heavy juice, likely -EV together
  const legs = [
    { ...cheap, name: "A", game: "g1" },
    { ...cheap, name: "B", game: "g1" }, // same game as A
    { ...cheap, name: "C", game: "g2" },
    { ...cheap, name: "D", game: "g3" },
    { ...juice, name: "E", game: "g4" },
  ];
  const { parlays, comboCount } = findMain3LegHits(legs, { maxResults: 10 });
  assert.ok(comboCount > 0);
  for (const p of parlays) {
    assert.equal(new Set(p.legs.map(l => l.game)).size, 3);
    assert.ok(passesEvThreshold(p.ev, 100, 2));
    assert.ok(p.evPct > 2);
  }
  // A+B+C is illegal (A and B same game) — only combos of distinct games
  const names = parlays.map(p => p.legs.map(l => l.name).sort().join("+"));
  assert.ok(!names.includes("A+B+C"));
}

// ── scan all books: global top, not 5 per book; fingerprint per book
{
  const futureIso = future;
  const mkGame = (away, home, dkAway, dkHome, fdAway, fdHome) => ({
    commence_time: futureIso,
    away_team: away,
    home_team: home,
    bookmakers: [
      { key: "draftkings", markets: [{ key: "h2h", outcomes: [{ name: away, price: dkAway }, { name: home, price: dkHome }] }] },
      { key: "fanduel", markets: [{ key: "h2h", outcomes: [{ name: away, price: fdAway }, { name: home, price: fdHome }] }] },
    ],
  });
  // Soft DK prices vs stiff opp on FD → +EV on DK. Reverse on a couple games for FD.
  const rows = [{
    sport: "baseball_mlb",
    data: [
      mkGame("Alpha", "Beta", 150, -130, -180, 160),
      mkGame("Gamma", "Delta", 140, -125, -175, 155),
      mkGame("Epsilon", "Zeta", 145, -128, -170, 150),
      mkGame("Eta", "Theta", -175, 155, 148, -132),
      mkGame("Iota", "Kappa", -172, 152, 142, -126),
      mkGame("Lambda", "Mu", -168, 148, 138, -122),
    ],
  }];
  const oddsData = hydrateFeaturedOdds(rows);
  const scan = scanBooksForEvParlays(oddsData, {
    books: [{ key: "draftkings", label: "DraftKings" }, { key: "fanduel", label: "FanDuel" }],
    candidateCap: 8,
    timeBudgetMs: 10000,
  });
  assert.ok(scan.comboCount > 0);
  assert.ok(scan.parlays.length >= 1);
  for (const p of scan.parlays) {
    assert.ok(p.evPct > 2);
    assert.ok(p.bookKey === "draftkings" || p.bookKey === "fanduel");
    assert.ok(p.fingerprint.startsWith(p.bookKey + "::"));
  }
  // ranked globally
  for (let i = 1; i < scan.parlays.length; i++) {
    assert.ok(scan.parlays[i - 1].ev >= scan.parlays[i].ev);
  }
}

// ── new bot token env name only (never KayGo TELEGRAM_BOT_TOKEN, never EV_ALERT_TELEGRAM_BOT_TOKEN)
{
  const scanSrc = fs.readFileSync(path.join(__dirname, "../api/scan-ev-parlays.js"), "utf8");
  const hookSrc = fs.readFileSync(path.join(__dirname, "../api/ev-alert-telegram-webhook.js"), "utf8");
  const tokenSrc = fs.readFileSync(path.join(__dirname, "./ev-parlays-bot-token.js"), "utf8");
  const flowSrc = fs.readFileSync(path.join(__dirname, "./ev-parlay-scan-flow.js"), "utf8");
  for (const src of [scanSrc, hookSrc, tokenSrc, flowSrc]) {
    assert.ok(!src.includes("EV_ALERT_TELEGRAM_BOT_TOKEN"));
    assert.ok(!src.includes("process.env.TELEGRAM_BOT_TOKEN"));
  }
  for (const src of [scanSrc, hookSrc, tokenSrc]) {
    assert.ok(src.includes("EVparlays_alert_telegram_bot_token"));
  }
  assert.equal(EV_PARLAYS_BOT_TOKEN_ENV, "EVparlays_alert_telegram_bot_token");
  assert.ok(tokenSrc.includes("Object.keys"));
}

// ── dedicated token: preferred name, case-insensitive fallback, trim, no KayGo
{
  const preferred = "EVparlays_alert_telegram_bot_token";
  const kaygo = { TELEGRAM_BOT_TOKEN: "kaygo-secret", EV_ALERT_TELEGRAM_BOT_TOKEN: "old-name" };
  assert.deepEqual(resolveEvParlaysBotToken({}), { token: "", envName: null });
  assert.equal(evParlaysBotToken({ ...kaygo }), "");
  assert.equal(evParlaysBotToken({ ...kaygo, [preferred]: "  " }), "");
  assert.deepEqual(
    resolveEvParlaysBotToken({ ...kaygo, [preferred]: "  mixed-token  " }),
    { token: "mixed-token", envName: preferred }
  );
  assert.deepEqual(
    resolveEvParlaysBotToken({ ...kaygo, EVPARLAYS_ALERT_TELEGRAM_BOT_TOKEN: "upper-token" }),
    { token: "upper-token", envName: "EVPARLAYS_ALERT_TELEGRAM_BOT_TOKEN" }
  );
  assert.deepEqual(
    resolveEvParlaysBotToken({
      [preferred]: "   ",
      EVPARLAYS_ALERT_TELEGRAM_BOT_TOKEN: "upper-after-empty",
    }),
    { token: "upper-after-empty", envName: "EVPARLAYS_ALERT_TELEGRAM_BOT_TOKEN" }
  );
  assert.deepEqual(
    resolveEvParlaysBotToken({
      ...kaygo,
      [preferred]: "preferred-wins",
      EVPARLAYS_ALERT_TELEGRAM_BOT_TOKEN: "upper-token",
    }),
    { token: "preferred-wins", envName: preferred }
  );
}

// ── recipient fallback: Kevin's user id as @evparlaysbot chat_id only (not KayGo bot)
{
  const kaygoWebhook = fs.readFileSync(path.join(__dirname, "../api/telegram-webhook.js"), "utf8");
  assert.match(kaygoWebhook, /const ADMIN_CHAT_ID = 8745205056/);
  assert.equal(KEVIN_EV_ALERT_CHAT_ID, "8745205056");

  assert.deepEqual(mergeEvAlertChatIds({ envChatId: "", rows: [] }), ["8745205056"]);
  assert.deepEqual(mergeEvAlertChatIds({ envChatId: "   ", rows: null }), ["8745205056"]);
  assert.deepEqual(mergeEvAlertChatIds({}), ["8745205056"]);
  assert.deepEqual(mergeEvAlertChatIds({ envChatId: "111", rows: [] }), ["111"]);
  assert.deepEqual(
    mergeEvAlertChatIds({ envChatId: "", rows: [{ telegram_chat_id: 222 }] }),
    ["222"]
  );
  const both = mergeEvAlertChatIds({
    envChatId: " 111 ",
    rows: [{ telegram_chat_id: 222 }, { telegram_chat_id: "111" }, { telegram_chat_id: null }],
  });
  assert.deepEqual(new Set(both), new Set(["111", "222"]));
  assert.ok(!both.includes("8745205056"));

  const scanSrc = fs.readFileSync(path.join(__dirname, "../api/scan-ev-parlays.js"), "utf8");
  const flowSrc = fs.readFileSync(path.join(__dirname, "./ev-parlay-scan-flow.js"), "utf8");
  assert.ok(scanSrc.includes("deliverEvParlayAlerts"));
  assert.ok(scanSrc.includes("resolveEvParlaysBotToken"));
  assert.ok(scanSrc.includes("runRequired"));
  assert.ok(scanSrc.includes("ODDS_CACHE_COLUMNS"));
  assert.ok(!scanSrc.includes(".select('*')"));
  assert.ok(flowSrc.includes("mergeEvAlertChatIds"));
  assert.match(flowSrc, /sendTelegramFn\(token,\s*chatId,\s*text\)/);
  assert.ok(!scanSrc.includes("process.env.TELEGRAM_BOT_TOKEN"));
  assert.ok(!scanSrc.includes("Kaygosports"));
  assert.ok(!flowSrc.includes("process.env.TELEGRAM_BOT_TOKEN"));
}

console.log("ev-parlay-alert.test.js ok");
