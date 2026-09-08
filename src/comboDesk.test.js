import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  remainingFill,
  quotingState,
  tapeNoPrice,
  formatCents,
  formatLoss,
  skipLabel,
  skipReasonOf,
  formatStoredSkipReason,
  lastSkip,
  lastLoss,
  lastRelevant,
  outcomesForParlay,
  comboDeskChrome,
  comboSectionKind,
  comboSettledQuery,
  comboListQueryOk,
  comboSettingsQueryOk,
  applyComboDeskPoll,
  buildParlayDesk,
} from "./comboDesk.js";

// ── remaining fill (ceilings accumulate; leftover is what the next RFQ can take) ──
{
  const r = remainingFill({ filled: 40, ceiling: 100 });
  assert.equal(r.filled, 40);
  assert.equal(r.ceiling, 100);
  assert.equal(r.left, 60);
  assert.equal(r.pct, 40);
}
{
  const r = remainingFill({ filled: 100, ceiling: 100 });
  assert.equal(r.left, 0);
  assert.equal(r.pct, 100);
}
{
  const r = remainingFill({ filled: 0, ceiling: 0 });
  assert.equal(r.left, 0);
  assert.equal(r.pct, 0);
}

// ── first-fetch chrome: no fake kill / empty Active until settings+parlays settle ──
{
  const loading = comboDeskChrome({ deskLoading: true, deskReady: false, kill: true });
  assert.equal(loading.ready, false);
  assert.equal(loading.showKillBanner, false);
  assert.equal(loading.killSwitchOn, false);
  assert.equal(loading.killSwitchDisabled, true);
  assert.equal(comboSectionKind({ deskLoading: true, deskReady: false, count: 0 }), "loading");
  assert.equal(comboSectionKind({ deskLoading: true, deskReady: false, count: 3 }), "rows");
}
{
  const live = comboDeskChrome({ deskLoading: false, deskReady: true, kill: true });
  assert.equal(live.ready, true);
  assert.equal(live.showKillBanner, true);
  assert.equal(live.killSwitchOn, true);
  assert.equal(live.killSwitchDisabled, false);
  assert.equal(comboSectionKind({ deskLoading: false, deskReady: true, count: 0 }), "empty");
  assert.equal(comboSectionKind({ deskLoading: false, deskReady: true, count: 2 }), "rows");
}
{
  const off = comboDeskChrome({ deskLoading: false, deskReady: true, kill: false });
  assert.equal(off.showKillBanner, false);
  assert.equal(off.killSwitchOn, false);
  assert.equal(comboSectionKind({ deskLoading: false, deskReady: true, count: 0 }), "empty");
}

// ── soft-fail poll: keep last known locks + kill; never invent kill-on / empty ──
{
  assert.equal(comboListQueryOk({ data: null, error: { message: "jwt" } }), false);
  assert.equal(comboListQueryOk({ data: [], error: null }), true);
  assert.equal(comboSettingsQueryOk({ data: null, error: null }), true);
  assert.equal(comboSettingsQueryOk({ data: null, error: { message: "jwt" } }), false);
  assert.deepEqual(comboSettledQuery({ status: "rejected", reason: { message: "timeout" } }), {
    data: null,
    error: { message: "timeout" },
  });
  assert.deepEqual(comboSettledQuery({ status: "fulfilled", value: { data: [], error: null } }), {
    data: [],
    error: null,
  });
}
{
  const prev = [{ id: "ari-jax", label: "Ari+Jax" }];
  const out = applyComboDeskPoll({
    parlaysRes: { data: null, error: { message: "jwt expired" } },
    settingsRes: { data: null, error: { message: "jwt expired" } },
    prevParlays: prev,
    prevKill: false,
    parlaysReady: true,
    settingsReady: true,
  });
  assert.equal(out.applyParlays, false);
  assert.equal(out.applyKill, false);
  assert.equal(out.kill, false);
  assert.equal(out.parlays[0].id, "ari-jax");
  assert.equal(out.deskReady, true);
  assert.match(out.errorNote, /last known/);
  assert.doesNotMatch(out.errorNote, /Supabase/);
  assert.equal(out.sourceUnhealthy, false);
  assert.equal(comboDeskChrome({ deskLoading: false, deskReady: true, kill: out.kill }).showKillBanner, false);
  assert.equal(comboSectionKind({ deskLoading: false, deskReady: true, count: out.parlays.length }), "rows");
}
{
  const first = applyComboDeskPoll({
    parlaysRes: { data: null, error: { message: "timeout" } },
    settingsRes: { data: null, error: { message: "timeout" } },
    prevParlays: [],
    prevKill: false,
    parlaysReady: false,
    settingsReady: false,
  });
  assert.equal(first.kill, false);
  assert.equal(first.deskReady, false);
  assert.match(first.errorNote, /Retrying/);
  assert.match(first.errorNote, /Supabase \/ PostgREST/);
  assert.equal(first.sourceUnhealthy, true);
  assert.equal(comboDeskChrome({ deskLoading: false, deskReady: false, kill: true }).showKillBanner, false);
  assert.equal(comboSectionKind({ deskLoading: false, deskReady: false, count: 0 }), "loading");
}
{
  const noRow = applyComboDeskPoll({
    parlaysRes: { data: [], error: null },
    settingsRes: { data: null, error: null },
    prevKill: true,
  });
  assert.equal(noRow.applyKill, true);
  assert.equal(noRow.kill, false);
  assert.equal(noRow.deskReady, true);
  assert.equal(noRow.errorNote, null);
}
{
  const liveKill = applyComboDeskPoll({
    parlaysRes: { data: [{ id: "1" }], error: null },
    settingsRes: { data: { kill_switch: true }, error: null },
  });
  assert.equal(liveKill.kill, true);
  assert.equal(liveKill.deskReady, true);
  assert.equal(comboDeskChrome({ deskLoading: false, deskReady: true, kill: true }).showKillBanner, true);
}
{
  const settingsOnly = applyComboDeskPoll({
    parlaysRes: { data: null, error: { message: "soft fail" } },
    settingsRes: { data: { kill_switch: true }, error: null },
    prevParlays: [],
    prevKill: false,
  });
  assert.equal(settingsOnly.applyParlays, false);
  assert.equal(settingsOnly.kill, true);
  assert.equal(settingsOnly.deskReady, false);
  assert.equal(comboDeskChrome({ deskLoading: false, deskReady: false, kill: true }).showKillBanner, false);
  assert.equal(comboSectionKind({ deskLoading: false, deskReady: false, count: 0 }), "loading");
}

// ── quoting on/off ──
assert.equal(quotingState({ active: true, kill: false, filled: 0, ceiling: 100 }).key, "watching");
assert.equal(quotingState({ active: false, kill: false, filled: 10, ceiling: 100 }).key, "paused");
assert.equal(quotingState({ active: true, kill: true, filled: 10, ceiling: 100 }).key, "kill");
assert.equal(quotingState({ active: false, kill: true, filled: 10, ceiling: 100 }).key, "kill");
assert.equal(quotingState({ active: false, kill: true, filled: 100, ceiling: 100 }).key, "ceiling");
assert.equal(quotingState({ active: true, kill: false, filled: 100, ceiling: 100 }).label, "deactivated at ceiling");
assert.equal(quotingState({ active: true, kill: false, filled: 40, ceiling: 100 }).quoting, true);
assert.equal(quotingState({ active: true, kill: true, filled: 40, ceiling: 100 }).quoting, false);

// ── tape clearing price: column or raw.tape fallback ──
assert.equal(tapeNoPrice({ tape_no_price: 0.91 }), 0.91);
assert.equal(tapeNoPrice({ raw: { tape: { no_price: 0.87, match: "matched" } } }), 0.87);
assert.equal(tapeNoPrice({ raw: { tape: { noPrice: 0.8 } } }), 0.8);
assert.equal(tapeNoPrice({}), null);
assert.equal(formatCents(0.91), "91¢");
assert.equal(formatCents(0.915), "92¢");

// ── last loss: outbid / too slow / no taker + tape price ──
assert.equal(formatLoss({ loss_reason: "outbid", tape_no_price: 0.91, tape_match: "matched" }), "outbid at 91¢");
assert.equal(formatLoss({ loss_reason: "no_purchase", raw: { tape: { match: "matched", no_price: 0.91 } } }), "outbid at 91¢");
assert.equal(formatLoss({ loss_reason: "no_purchase" }), "no taker");
assert.equal(formatLoss({ loss_reason: "too_slow" }), "too slow");
assert.equal(formatLoss({ loss_reason: "no_taker" }), "no taker");
assert.equal(formatLoss({ outcome: "lost" }), "lost");

{
  const loss = lastLoss([
    { outcome: "lost", loss_reason: "too_slow", posted_at: "2026-08-13T12:00:00Z" },
    { outcome: "lost", loss_reason: "outbid", tape_no_price: 0.91, tape_match: "matched", posted_at: "2026-08-13T13:00:00Z" },
    { outcome: "executed", posted_at: "2026-08-13T14:00:00Z" },
  ]);
  assert.equal(loss.reason, "outbid");
  assert.equal(loss.text, "outbid at 91¢");
  assert.equal(loss.clearingCents, "91¢");
}
assert.equal(lastLoss([{ outcome: "executed" }]), null);

// ── last skip: matched RFQ with no quote_outcome, especially oversized ──
{
  const oversized = skipLabel({ contracts: 250 }, { filled: 40, ceiling: 100 });
  assert.equal(oversized.kind, "oversized");
  assert.match(oversized.text, /skipped oversized 250/);
  assert.match(oversized.text, /60/);
}
{
  const small = skipLabel({ contracts: 10 }, { filled: 40, ceiling: 100 });
  assert.equal(small.kind, "skipped");
  assert.equal(small.text, "skipped 10");
}
{
  assert.equal(skipReasonOf({ skip_reason: "game_started" }), "game_started");
  assert.equal(skipReasonOf({ skipReason: "limit_reached" }), "limit_reached");
  assert.equal(skipReasonOf({ raw: { skip_reason: "oversized" } }), "oversized");
  assert.equal(formatStoredSkipReason("game_started"), "game started");
  assert.equal(formatStoredSkipReason("no_lock_overlap:leg_count"), "different leg count");
  assert.equal(formatStoredSkipReason("no_lock_overlap:same_games_no_match"), "same games, no match");
  assert.equal(formatStoredSkipReason("no_lock_overlap:no_shared_game x12"), "no shared game ×12");
  assert.equal(formatStoredSkipReason("no_lock_overlap:mystery_code"), "no_lock_overlap:mystery_code");
  assert.equal(formatStoredSkipReason("insufficient_balance"), "insufficient funds");
  assert.equal(formatStoredSkipReason("insufficient_funds"), "insufficient funds");
  assert.equal(formatStoredSkipReason("insufficient-balance"), "insufficient funds");
  assert.equal(formatStoredSkipReason("underfunded"), "insufficient funds");
  assert.equal(formatStoredSkipReason("low_balance"), "insufficient funds");
  const started = skipLabel({ skip_reason: "game_started", contracts: 80 }, { filled: 40, ceiling: 100 });
  assert.equal(started.kind, "skipped");
  assert.equal(started.text, "skipped · game started");
  const overlap = skipLabel({ skip_reason: "no_lock_overlap:same_games_no_match", contracts: 8 });
  assert.equal(overlap.text, "skipped · same games, no match");
  const noise = skipLabel({ skip_reason: "no_lock_overlap:no_shared_game x7" });
  assert.equal(noise.text, "skipped · no shared game ×7");
  const unknown = skipLabel({ skip_reason: "poly_new_guard" });
  assert.equal(unknown.text, "skipped · poly_new_guard");
  const cap = skipLabel({ skip_reason: "limit_reached", contracts: 20 }, { filled: 40, ceiling: 100 });
  assert.equal(cap.text, "skipped · cap reached");
  const funds = skipLabel({ skip_reason: "insufficient_balance", contracts: 12 }, { filled: 40, ceiling: 100 });
  assert.equal(funds.kind, "skipped");
  assert.equal(funds.text, "skipped · insufficient funds");
  const fundsSyn = skipLabel({ skip_reason: "insufficient_funds" });
  assert.equal(fundsSyn.text, "skipped · insufficient funds");
  const storedOversize = skipLabel({ skip_reason: "oversized", contracts: 250 }, { filled: 40, ceiling: 100 });
  assert.equal(storedOversize.kind, "oversized");
  assert.match(storedOversize.text, /skipped oversized 250/);
}
{
  const skip = lastSkip({
    matches: [
      { rfq_id: "quoted-1", matched_at: "2026-08-13T14:00:00Z", contracts: 20 },
      { rfq_id: "skip-big", matched_at: "2026-08-13T13:00:00Z", contracts: 250 },
      { rfq_id: "skip-old", matched_at: "2026-08-13T12:00:00Z", contracts: 8 },
    ],
    outcomeByRfq: { "quoted-1": { outcome: "lost" } },
    filled: 40,
    ceiling: 100,
  });
  assert.equal(skip.rfqId, "skip-big");
  assert.equal(skip.kind, "oversized");
  assert.match(skip.text, /250/);
}
assert.equal(lastSkip({ matches: [{ rfq_id: "q", matched_at: "2026-08-13T12:00:00Z" }], outcomeByRfq: { q: { outcome: "posted" } } }), null);
{
  const skip = lastSkip({
    matches: [{ rfq_id: "poly-1", matched_at: "2026-09-07T16:00:00Z", contracts: 80 }],
    submissions: [{ rfq_id: "poly-1", status: "declined", skip_reason: "game_started", contracts: 80 }],
    filled: 40,
    ceiling: 100,
  });
  assert.equal(skip.rfqId, "poly-1");
  assert.equal(skip.kind, "skipped");
  assert.equal(skip.text, "skipped · game started");
}
{
  const skip = lastSkip({
    matches: [{ rfq_id: "k-funds", matched_at: "2026-09-07T17:00:00Z", contracts: 20 }],
    submissions: [{ rfq_id: "k-funds", status: "declined", skip_reason: "insufficient_balance", contracts: 20 }],
    filled: 40,
    ceiling: 100,
  });
  assert.equal(skip.rfqId, "k-funds");
  assert.equal(skip.text, "skipped · insufficient funds");
}

// ── last relevant prefers the newer of skip vs loss ──
{
  const skip = { at: "2026-08-13T15:00:00Z", text: "skipped 12", kind: "skipped" };
  const loss = { at: "2026-08-13T14:00:00Z", text: "outbid at 91¢" };
  assert.equal(lastRelevant(skip, loss).kind, "skip");
  assert.equal(lastRelevant(skip, { ...loss, at: "2026-08-13T16:00:00Z" }).kind, "loss");
  assert.equal(lastRelevant(null, loss).kind, "loss");
  assert.equal(lastRelevant(null, null), null);
}

// ── outcomes join by parlay_id or matched rfq_id (unseeded watcher rows) ──
{
  const rows = outcomesForParlay(
    [
      { parlay_id: "p1", rfq_id: "a" },
      { parlay_id: "p2", rfq_id: "b" },
      { parlay_id: null, rfq_id: "c" },
    ],
    { parlayId: "p1", matches: [{ rfq_id: "c" }] },
  );
  assert.deepEqual(rows.map((r) => r.rfq_id).sort(), ["a", "c"]);
}

// ── full desk for an active card ──
{
  const desk = buildParlayDesk({
    parlay: { id: "p1", active: true, max_contracts: 100 },
    filled: 40,
    quoted: 40,
    kill: false,
    matches: [
      { rfq_id: "lost-1", matched_at: "2026-08-13T12:00:00Z", contracts: 20 },
      { rfq_id: "skip-1", matched_at: "2026-08-13T13:00:00Z", contracts: 80 },
    ],
    submissions: [
      { rfq_id: "skip-1", status: "declined", skip_reason: "no_lock_overlap:same_games_no_match", contracts: 80 },
    ],
    outcomes: [
      { parlay_id: "p1", rfq_id: "lost-1", outcome: "lost", loss_reason: "outbid", tape_no_price: 0.91, tape_match: "matched", posted_at: "2026-08-13T12:01:00Z" },
    ],
    outcomeByRfq: {
      "lost-1": { outcome: "lost" },
    },
  });
  assert.equal(desk.fill.left, 60);
  assert.equal(desk.quote.key, "watching");
  assert.equal(desk.skip.kind, "skipped");
  assert.equal(desk.skip.text, "skipped · same games, no match");
  assert.equal(desk.loss.text, "outbid at 91¢");
  assert.equal(desk.awaiting, false);
}

{
  const desk = buildParlayDesk({
    parlay: { id: "p1", active: false, max_contracts: 100 },
    filled: 100,
    kill: true,
  });
  assert.equal(desk.quote.key, "ceiling");
  assert.equal(desk.fill.left, 0);
}

// ── ComboLocks.jsx wires first-fetch chrome (no fake kill / empty Active) ──
{
  const page = readFileSync(new URL("./ComboLocks.jsx", import.meta.url), "utf8");
  assert.match(page, /const \[kill, setKill\] = useState\(false\)/);
  assert.match(page, /useState\(true\); \/\/ first settings\+parlays fetch/);
  assert.doesNotMatch(page, /useState\(true\); \/\/ safe default until settings load/);
  assert.match(page, /comboDeskChrome/);
  assert.match(page, /comboSectionKind/);
  assert.match(page, /applyComboDeskPoll/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /comboSettledQuery/);
  assert.match(page, /deskChrome\.showKillBanner/);
  assert.match(page, /deskChrome\.killSwitchOn/);
  assert.match(page, /deskChrome\.killSwitchDisabled/);
  assert.match(page, /deskChrome\.deskError/);
  assert.match(page, /comboDeskCatchNote/);
  assert.match(page, /DataSourceBanner/);
  assert.match(page, /sourceUnhealthy/);
  assert.match(page, /Supabase flaky/);
  assert.match(page, /waitingKind === "loading"/);
  assert.match(page, /waitingKind === "empty"/);
  assert.match(page, /Loading locks/);
  assert.match(page, /className="empty loading"/);
  assert.match(page, /setDeskLoading\(false\)/);
  assert.match(page, /setDeskError/);
  assert.doesNotMatch(page, /setKill\(\!\!\(s && s\.kill_switch\)\)/);
  assert.doesNotMatch(page, /livingRows = p \|\| \[\]/);
  assert.match(page, /if \(deskLoading \|\| !deskReady\) return;/);
  assert.match(page, /kill: deskReady && !deskLoading \? kill : false/);
}

console.log("comboDesk.test.js ok");
