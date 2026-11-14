// Glue: locks + live venue data → "What to root for" summary (pure; the API does the fetching).
import { legEvent, rootFor, NEITHER } from "./rootForEngine.js";
import { legFair, american } from "./rootForPrices.js";
import { lockPositions } from "./rootForLocks.js";
import { deskFillCounts, isConfirmedFillSubmission } from "./comboTape.js";
import { interpLine, lineGapEvents, marginBands, parseLadderTicker, spreadAllowed, spreadCoverK, totalAllowed, totalBands, totalCoverK } from "./rootForBookLine.js";

export { lineGapEvents, parseLadderTicker };

const SPREAD_RE = /^(KX[A-Z]+)SPREAD-(\d{2}[A-Z]{3}\d{2}[A-Z]+)-([A-Z]+?)(\d+)$/;
/** "KXNFLSPREAD-26OCT18NYJNE-NE8" → { game:"KXNFLGAME-26OCT18NYJNE", team:"NE", k:8 } ("NE wins by k+"). */
export function parseSpread(ticker) {
  const m = SPREAD_RE.exec(String(ticker || "").toUpperCase());
  return m ? { game: `${m[1]}GAME-${m[2]}`, team: m[3], k: Number(m[4]) } : null;
}

/** Kalshi tickers whose orderbooks we need (each leg, both moneyline sides of every game touched). */
export function tickersNeeded(parlays) {
  const s = new Set();
  for (const p of parlays || []) for (const l of p.legs || []) {
    const t = String(l.ticker || "").toUpperCase();
    const sp = parseSpread(t);
    if (sp) { s.add(t); const r = legEvent({ ticker: `${sp.game}-${sp.team}` }); if (r.kind === "game") for (const x of r.outcomes) s.add(`${r.event}-${x}`); continue; }
    const r = legEvent(l);
    if (r.kind === "game") for (const x of r.outcomes) s.add(`${r.event}-${x}`);
    else if (t) s.add(t);
  }
  return [...s];
}

/** ET time slot for a start time: Sun 1 PM / Sun 4 PM / Night (Sun–Mon night) / Other days. */
export function timeSlot(iso) {
  if (!iso) return { key: "4-other", label: "Other days" };
  const d = new Date(iso);
  const wd = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  const h = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })) % 24;
  if (wd === "Sun" && h < 15) return { key: "1-sun1", label: "Sunday 1 PM" };
  if (wd === "Sun" && h < 19) return { key: "2-sun4", label: "Sunday 4 PM" };
  if ((wd === "Sun" || wd === "Mon") && h >= 19) return { key: "3-night", label: "Sunday / Monday night" };
  return { key: "4-other", label: "Other days" };
}

// Final result of a finished game from its last live chances (snapshot): the outcome at >= 95%, mapped onto this
// event's outcome list (a team maps onto a plain team outcome; a spread bucket maps onto its bucket or its team).
// Ambiguous (team won but the list splits that team into margin buckets) -> null, the game stays unpriced.
export const FINAL_MIN_P = 0.95;
export function finalOutcome(last, outs = []) {
  if (!last) return null;
  const [w, p] = Object.entries(last).filter(([o]) => o !== NEITHER).sort((x, y) => y[1] - x[1])[0] || [];
  if (!(p >= FINAL_MIN_P)) return null;
  if (outs.includes(w)) return w;
  const team = String(w).split(/[<>]=?/)[0];
  return team !== w && outs.includes(team) ? team : null;
}

// extraPositions: ready-made engine positions ({ id, label, legs:[{ticker, side, label, game}], hit, miss }) that are
// not Combo Locks (the Sniper dashboard feeds its own filled positions through the same engine).
export function computeRootFor({ parlays = [], fills = [], singles = [], submissions = null, kalshiBooks = {}, relay = {}, starts = {}, now = Date.now(), kalshiAt = now, opts = {}, finals = {}, extraPositions = [], legFairFn = null, ladders = {} }) {
  const positions = [...extraPositions]; const skipped = []; let resting = 0;
  // same contract count as History P/L (only when the caller loaded submissions)
  const filledBy = submissions ? deskFillCounts(fills, submissions.filter(isConfirmedFillSubmission)).byParlay : null;
  for (const p of parlays) {
    const r = lockPositions(p, fills, singles, filledBy ? (filledBy[p.id] || 0) : null);
    if (r.skip) { skipped.push({ id: p.id, label: p.label, reason: r.skip }); continue; }
    resting += r.positions[0].resting || 0;
    positions.push(...r.positions);
  }
  const px = { kalshiBooks, relay, now, kalshiAt };
  const legInfo = {}; const fair = (ticker, side) => { const k = `${ticker}:${side}`; if (!(k in legInfo)) legInfo[k] = (legFairFn || legFair)({ ticker, side }, px); return legInfo[k]; };
  const games = {}; const gameName = (ev, team) => { const g = games[ev]; const r = legEvent({ ticker: `${ev}-${team}` }); const half = g && r.kind === "game" ? String(g).split(/\s+vs\.?\s+/i)[r.outcomes.indexOf(team)] : null; return half || team; };

  // ---- 1. which games get a spread nested into their moneyline (one team + one strike per game)
  const spreadOf = {}; const notes = [];
  for (const pos of positions) for (const l of pos.legs) {
    if (l.game) { const sp = parseSpread(l.ticker); const r = sp ? legEvent({ ticker: `${sp.game}-${sp.team}` }) : legEvent(l); games[r.event] = games[r.event] || (r.kind === "game" ? l.game : `${l.game} total`); }
    const sp = parseSpread(l.ticker);
    if (!sp) continue;
    const cur = spreadOf[sp.game];
    if (!cur) spreadOf[sp.game] = { ...sp, ticker: String(l.ticker).toUpperCase(), sides: new Set([l.side || "yes"]) };
    else if (cur.team === sp.team && cur.k === sp.k) cur.sides.add(l.side || "yes");
    else cur.conflict = true;
  }
  for (const [g, sp] of Object.entries(spreadOf)) if (sp.conflict) { delete spreadOf[g]; notes.push(`${g}: several spread lines, kept independent of the moneyline`); }

  // ---- 2. resolve every leg into (event, allowed) and build event outcome lists
  const evOutcomes = {}; const evKind = {}; const mlHeld = {}; const names = {};
  const resolve = (l) => {
    const t = String(l.ticker || "").toUpperCase(); const side = (l.side || "yes").toLowerCase();
    const sp = parseSpread(t);
    if (sp && spreadOf[sp.game]) {
      const g = legEvent({ ticker: `${sp.game}-${sp.team}` });
      const S = sp.team; const O = g.outcomes.find((x) => x !== S);
      const big = `${S}>=${sp.k}`, small = `${S}<${sp.k}`;
      evOutcomes[sp.game] = [big, small, O]; evKind[sp.game] = "game";
      names[`${sp.game}:${big}`] = `${gameName(sp.game, S)} by ${sp.k}+`; names[`${sp.game}:${small}`] = `${gameName(sp.game, S)} by under ${sp.k}`;
      return { event: sp.game, kind: "game", outcomes: evOutcomes[sp.game], allowed: side === "no" ? [small, O] : [big], label: l.label, spread: true, bookLine: l.bookLine || null, side, ticker: t };
    }
    const r = legEvent(l);
    if (r.kind === "game") {
      if (r.allowed.length === 1) (mlHeld[r.event] = mlHeld[r.event] || new Set()).add(r.allowed[0]);
      const spd = spreadOf[r.event];
      if (spd) {
        const S = spd.team; const parts = { [S]: [`${S}>=${spd.k}`, `${S}<${spd.k}`] };
        const allowed = r.allowed.flatMap((o) => parts[o] || [o]);
        evOutcomes[r.event] = evOutcomes[r.event] || [`${S}>=${spd.k}`, `${S}<${spd.k}`, r.outcomes.find((x) => x !== S)]; evKind[r.event] = "game";
        return { event: r.event, kind: "game", outcomes: evOutcomes[r.event], allowed, label: l.label, bookLine: l.bookLine || null, side, ticker: t };
      }
      evOutcomes[r.event] = evOutcomes[r.event] || [...r.outcomes]; evKind[r.event] = "game";
      return { event: r.event, kind: "game", outcomes: evOutcomes[r.event], allowed: r.allowed, label: l.label, bookLine: l.bookLine || null, side, ticker: t };
    }
    evOutcomes[r.event] = ["yes", "no"]; evKind[r.event] = "binary";
    if (l.label) names[`${r.event}:${r.allowed[0]}`] = l.label + (side === "no" ? " (No)" : "");
    return { ...r, label: l.label, bookLine: l.bookLine || null, side, ticker: t };
  };
  const resolved = positions.map((pos) => ({ ...pos, legs: pos.legs.map(resolve) }));
  // spread games: make sure the moneyline outcome list is the refined one for every leg
  // ...and re-split any moneyline leg resolved as a plain team ("DET") into that team's buckets ("DET>=4","DET<4")
  for (const pos of resolved) for (const l of pos.legs) {
    const sp = spreadOf[l.event]; if (!sp || l.kind !== "game") continue;
    l.outcomes = evOutcomes[l.event];
    const parts = { [sp.team]: [`${sp.team}>=${sp.k}`, `${sp.team}<${sp.k}`] };
    l.allowed = [...new Set(l.allowed.flatMap((o) => parts[o] || [o]))];
  }

  // ---- 3. inverse chances per event. Two-way markets (and a yes/no held on both sides) are scaled to 100%.
  // A leftover "neither" would be a fake third result where both locks lose. A draw stays only on a real 3-way market.
  const probs = {}; const shown = {}; const unpricedEv = new Set(); const clamps = []; const finalEv = {};
  // why an event has no price: 'stale' (only old books), 'thin' (books too shallow / failed walk), 'no_book' (no source)
  const unpricedWhy = {};
  const whyNone = (...fs) => { const src = fs.flatMap((x) => (x && x.sources) || []); if (src.some((x) => x.reason === "stale")) return "stale"; return src.length ? "thin" : "no_book"; };
  // finished game (no live price): count it at its final result (1 = winner, 0 = rest) instead of dropping its locks
  const settle = (ev, outs) => { const w = finalOutcome(finals[ev], outs); if (w == null) return false; probs[ev] = Object.fromEntries(outs.map((o) => [o, o === w ? 1 : 0])); finalEv[ev] = w; return true; };
  for (const [ev, outs] of Object.entries(evOutcomes)) {
    if (evKind[ev] === "binary") {
      const held = new Set(); for (const pos of resolved) for (const l of pos.legs) if (l.event === ev) held.add(l.allowed[0]);
      const py = held.has("yes") ? fair(ev, "yes").p : null; const pn = held.has("no") ? fair(ev, "no").p : null;
      if (py == null && pn == null) { if (!settle(ev, outs)) { unpricedEv.add(ev); unpricedWhy[ev] = whyNone(held.has("yes") ? fair(ev, "yes") : null, held.has("no") ? fair(ev, "no") : null); } continue; }
      if (py != null && pn != null) { const z = py + pn; probs[ev] = z > 0 ? { yes: py / z, no: pn / z } : { yes: 0.5, no: 0.5 }; }
      else probs[ev] = py != null ? { yes: py, no: 1 - py } : { yes: 1 - pn, no: pn };
      continue;
    }
    const teams = (() => { const sp = spreadOf[ev]; if (!sp) return outs; const r = legEvent({ ticker: `${ev}-${sp.team}` }); return r.outcomes; })();
    // UCL (and only a 3-way ticker): each side's fair is its own inverse No.
    // The unpriced side keeps whatever probability the priced sides leave, so a
    // draw is not given to the other club. 2-way sports stay on the block below.
    if (teams.includes("TIE")) {
      const ps = {};
      let sum = 0;
      let n = 0;
      for (const t of teams) {
        const p = fair(`${ev}-${t}`, "yes").p;
        if (p != null) { ps[t] = p; sum += p; n += 1; shown[`${ev}:${t}`] = p; }
      }
      if (!n) { if (!settle(ev, outs)) { unpricedEv.add(ev); unpricedWhy[ev] = whyNone(...teams.map((t) => fair(`${ev}-${t}`, "yes"))); } continue; }
      const row = { ...ps };
      if (n === teams.length) {
        if (sum > 0) { for (const t of teams) row[t] = ps[t] / sum; }
      } else if (n === teams.length - 1) {
        const missing = teams.find((t) => row[t] == null);
        row[missing] = Math.max(0, 1 - sum);
        shown[`${ev}:${missing}`] = row[missing];
      } else {
        for (const t of teams) if (row[t] == null) row[t] = 0;
        row[NEITHER] = Math.max(0, 1 - sum);
      }
      probs[ev] = row;
      continue;
    }
    const [a, b] = teams; const held = mlHeld[ev] || new Set();
    const ra = fair(`${ev}-${a}`, "yes").p, rb = fair(`${ev}-${b}`, "yes").p;
    let pa, pb, pn = 0;
    if (held.has(a) && held.has(b) && ra != null && rb != null) { const z = ra + rb; if (!(z > 0)) { unpricedEv.add(ev); unpricedWhy[ev] = "thin"; continue; } pa = ra / z; pb = rb / z; } // both sides held: always scale to 100%
    else if (held.has(b) && !held.has(a) && rb != null) { pb = rb; pa = 1 - rb; }
    else if (ra != null) { pa = ra; pb = 1 - ra; }
    else if (rb != null) { pb = rb; pa = 1 - rb; }
    else { if (!settle(ev, outs)) { unpricedEv.add(ev); unpricedWhy[ev] = whyNone(fair(`${ev}-${a}`, "yes"), fair(`${ev}-${b}`, "yes")); } continue; }
    shown[`${ev}:${a}`] = pa; shown[`${ev}:${b}`] = pb;
    const sp = spreadOf[ev];
    if (!sp) { probs[ev] = { [a]: pa, [b]: pb, ...(pn > 0 ? { [NEITHER]: pn } : {}) }; continue; }
    const S = sp.team, O = teams.find((x) => x !== S); const pS = S === a ? pa : pb, pO = S === a ? pb : pa;
    let big;
    if (sp.sides.has("yes")) { const y = fair(sp.ticker, "yes").p; big = y; }
    if (big == null && sp.sides.has("no")) { const n = fair(sp.ticker, "no").p; if (n != null) big = pS - (n - pO); }
    if (big == null) { if (!settle(ev, outs)) { unpricedEv.add(ev); unpricedWhy[ev] = whyNone(fair(sp.ticker, "yes"), fair(sp.ticker, "no")); } continue; }
    if (big > pS || big < 0) { clamps.push(ev); big = Math.min(pS, Math.max(0, big)); }
    probs[ev] = { [`${S}>=${sp.k}`]: big, [`${S}<${sp.k}`]: pS - big, [O]: pO, ...(pn > 0 ? { [NEITHER]: pn } : {}) };
    shown[`${ev}:${S}>=${sp.k}`] = big;
  }

  // ---- 3b. Price the sportsbook line, not the Kalshi proxy, when those numbers differ.
  // The hedge (if any) stays on the proxy contract, so a win-by-2 that covers −1.5 but not −2.5 is its own outcome.
  const fineGroups = {};
  const lineNote = (pos, bookLine) => {
    const want = bookLine.kind === "total" ? `${bookLine.ou === "under" ? "Under" : "Over"} ${bookLine.line}` : `${bookLine.sign === "+" ? "+" : "−"}${bookLine.line}`;
    const got = bookLine.kind === "total" ? `${bookLine.ou === "under" ? "Under" : "Over"} ${bookLine.proxyLine}` : `${bookLine.sign === "+" ? "+" : "−"}${bookLine.proxyLine}`;
    const text = `${pos.label}: sportsbook ${want} has no Kalshi price between strikes, so that leg is priced on the Kalshi line ${got}.`;
    if (!notes.includes(text)) notes.push(text);
  };
  const spreadEvents = new Set();
  for (const pos of resolved) for (const l of pos.legs) if (l.bookLine && l.bookLine.kind === "spread" && probs[l.event] && !unpricedEv.has(l.event)) spreadEvents.add(l.event);
  const spreadFail = new Set();
  for (const ev of spreadEvents) {
    const sp = spreadOf[ev];
    const row = probs[ev];
    const sample = resolved.flatMap((p) => p.legs).find((l) => l.event === ev && l.bookLine && l.bookLine.kind === "spread");
    if (!sp || !row || !sample) { spreadFail.add(ev); continue; }
    const team = sp.team;
    const opp = Object.keys(row).find((k) => k !== NEITHER && k !== team && !String(k).startsWith(team));
    if (!opp) { spreadFail.add(ev); continue; }
    const pWin = Object.entries(row).filter(([k]) => k === team || String(k).startsWith(team)).reduce((a, [, v]) => a + Number(v || 0), 0);
    const points = [];
    if (pWin > 0 && pWin < 1) points.push({ line: 0.5, p: pWin });
    const pStrike = fair(sp.ticker, "yes").p;
    if (pStrike != null) points.push({ line: sp.k - 0.5, p: pStrike });
    const ladderEv = String(sample.ticker || "").split("-").slice(0, 2).join("-");
    for (const m of ladders[ladderEv] || []) {
      if (m.team && m.team !== team) continue;
      const p = fair(m.ticker, "yes").p;
      if (p != null) points.push({ line: m.line, p });
    }
    const cuts = [1, sp.k];
    let pricedOk = true;
    for (const pos of resolved) for (const l of pos.legs) {
      if (l.event !== ev || !l.bookLine || l.bookLine.kind !== "spread") continue;
      cuts.push(spreadCoverK(l.bookLine.line));
      if (interpLine(points, l.bookLine.line) == null) pricedOk = false;
    }
    const built = pricedOk ? marginBands(team, opp, (k) => interpLine(points, k - 0.5), cuts) : null;
    if (!built) { spreadFail.add(ev); continue; }
    probs[ev] = built.probs;
    evOutcomes[ev] = Object.keys(built.probs);
    const teamName = gameName(ev, team);
    for (const b of built.bands) names[`${ev}:${b.key}`] = b.hi == null ? `${teamName} by ${b.lo}+` : (b.lo + 1 === b.hi ? `${teamName} by ${b.lo}` : `${teamName} by ${b.lo}–${b.hi - 1}`);
    fineGroups[ev] = { [team]: built.bands.map((b) => b.key), [opp]: [opp] };
    for (const pos of resolved) for (const l of pos.legs) {
      if (l.event !== ev || l.kind !== "game") continue;
      l.outcomes = evOutcomes[ev];
      if (l.bookLine && l.bookLine.kind === "spread") {
        l.proxyAllowed = spreadAllowed(l.side === "no" ? "+" : "-", sp.k - 0.5, built.bands, opp);
        l.allowed = spreadAllowed(l.bookLine.sign, l.bookLine.line, built.bands, opp);
      } else if (l.spread) l.allowed = spreadAllowed(l.side === "no" ? "+" : "-", sp.k - 0.5, built.bands, opp);
      else {
        const old = l.allowed || [];
        const wantsTeam = old.some((o) => o === team || String(o).startsWith(team));
        const wantsOpp = old.includes(opp);
        l.allowed = [...(wantsTeam ? built.bands.map((b) => b.key) : []), ...(wantsOpp ? [opp] : [])];
      }
    }
  }
  for (const pos of resolved) for (const l of pos.legs) if (l.bookLine && l.bookLine.kind === "spread" && spreadFail.has(l.event)) lineNote(pos, l.bookLine);

  const totalEvents = new Map();
  for (const pos of resolved) for (const l of pos.legs) {
    if (!l.bookLine || l.bookLine.kind !== "total" || !probs[l.event] || unpricedEv.has(l.event)) continue;
    if (!totalEvents.has(l.event)) totalEvents.set(l.event, []);
    totalEvents.get(l.event).push({ pos, leg: l });
  }
  for (const [ev, items] of totalEvents) {
    const row = probs[ev];
    const proxyLine = items[0].leg.bookLine.proxyLine;
    const points = [];
    if (row && row.yes > 0 && row.yes < 1) points.push({ line: proxyLine, p: row.yes });
    const own = fair(items[0].leg.ticker, "yes").p;
    if (own != null) points.push({ line: proxyLine, p: own });
    const ladderEv = String(items[0].leg.ticker || "").split("-").slice(0, 2).join("-");
    for (const m of ladders[ladderEv] || []) {
      if (m.kind && m.kind !== "total") continue;
      const p = fair(m.ticker, "yes").p;
      if (p != null) points.push({ line: m.line, p });
    }
    const got = new Map();
    for (const { leg } of items) {
      const p = interpLine(points, leg.bookLine.line);
      if (p != null) got.set(leg, p);
    }
    if (items.some(({ leg }) => !got.has(leg))) { for (const { pos, leg } of items) if (!got.has(leg)) lineNote(pos, leg.bookLine); continue; }
    const lines = new Set(items.map(({ leg }) => leg.bookLine.line));
    const hedged = items.some(({ pos }) => Number(pos.filled) > 0);
    if (!hedged && lines.size === 1) {
      const p = got.get(items[0].leg);
      probs[ev] = { yes: p, no: 1 - p };
      shown[`${ev}:yes`] = p;
      continue;
    }
    const cuts = [];
    for (const { leg } of items) cuts.push(totalCoverK(leg.bookLine.line), totalCoverK(leg.bookLine.proxyLine));
    const built = totalBands((n) => interpLine(points, n - 0.5), cuts);
    if (!built) { for (const { pos, leg } of items) lineNote(pos, leg.bookLine); continue; }
    probs[ev] = built.probs;
    evOutcomes[ev] = Object.keys(built.probs);
    for (const b of built.bands) names[`${ev}:${b.key}`] = b.hi == null ? `Total ${b.lo}+` : (b.lo == null ? `Total under ${b.hi}` : (b.lo + 1 === b.hi ? `Total ${b.lo}` : `Total ${b.lo}–${b.hi - 1}`));
    fineGroups[ev] = { over: built.bands.filter((b) => b.lo != null).map((b) => b.key), under: built.bands.filter((b) => b.lo == null).map((b) => b.key) };
    for (const pos of resolved) for (const l of pos.legs) {
      if (l.event !== ev) continue;
      l.outcomes = evOutcomes[ev];
      const ou = l.bookLine && l.bookLine.kind === "total" ? l.bookLine.ou : (l.side === "no" ? "under" : "over");
      const line = l.bookLine && l.bookLine.kind === "total" ? l.bookLine.line : proxyLine;
      if (l.bookLine && l.bookLine.kind === "total") l.proxyAllowed = totalAllowed(l.side === "no" ? "under" : "over", proxyLine, built.bands);
      l.allowed = totalAllowed(ou, line, built.bands);
    }
  }
  const lineHedges = [];
  for (const pos of resolved) {
    if (!(Number(pos.filled) > 0) || pos.bookHit == null) continue;
    if (!(pos.legs || []).some((l) => l.proxyAllowed)) continue;
    lineHedges.push({
      ...pos,
      id: `${pos.id}:line`,
      single: true,
      lineHedge: true,
      label: `${pos.label} · Kalshi hedge`,
      legs: pos.legs.map((l) => ({ ...l, allowed: [...(l.proxyAllowed || l.allowed || [])], outcomes: [...(l.outcomes || [])] })),
      hit: pos.hedgeHit,
      miss: pos.hedgeMiss,
    });
    pos.hit = pos.bookHit;
    pos.miss = pos.bookMiss;
  }
  resolved.push(...lineHedges);

  // a lock needs every event priced
  const priced = []; const unpriced = [];
  // unpriced entries keep their engine legs + the lock's first kickoff so the day snapshot can still count their
  // settled result (Actual P/L) without pricing them
  const startOf = {}; for (const p of parlays) if (p && p.id) startOf[p.id] = p.starts_at || null;
  for (const pos of resolved) { const bad = pos.legs.find((l) => unpricedEv.has(l.event)); if (bad) unpriced.push({ id: pos.id, label: pos.label, leg: bad.label || bad.event, reason: unpricedWhy[bad.event] || "no_book", hit: pos.hit, miss: pos.miss, start: startOf[String(pos.id).split(":")[0]] || null, legs: pos.legs.map(({ event, kind, outcomes, allowed }) => ({ event, kind, outcomes, allowed })) }); else priced.push(pos); }
  // locks only (single-leg hedge positions are not counted), grouped by reason, for the page text
  const unpricedLocks = unpriced.filter((u) => !String(u.id).includes(":"));
  const unpricedReasons = {}; for (const u of unpricedLocks) unpricedReasons[u.reason] = (unpricedReasons[u.reason] || 0) + 1;

  const res = rootFor(priced, probs, { ...opts, histBins: opts.histBins || 32 });
  const nameOf = (event, outcome) => {
    if (names[`${event}:${outcome}`]) return names[`${event}:${outcome}`];
    if (evKind[event] === "game") return gameName(event, outcome);
    const other = names[`${event}:${outcome === "yes" ? "no" : "yes"}`];
    return other ? `Not: ${other}` : `${event} ${outcome}`;
  };
  const evStart = (ev) => starts[ev] || starts[String(ev).split("-").slice(0, 2).join("-").replace(/(TOTAL|SPREAD)-/, "GAME-")] || null;
  const decorate = (r) => ({ ...r, name: nameOf(r.event, r.outcome), game: games[r.event] || r.event, american: american(r.p), start: evStart(r.event), slot: timeSlot(evStart(r.event)) });
  const perEvent = res.perEvent.map((e) => ({ ...e, game: games[e.event] || e.event, rootForName: e.rootFor != null ? nameOf(e.event, e.rootFor) : null, american: american(e.p), start: evStart(e.event), slot: timeSlot(evStart(e.event)), outcomes: e.outcomes.map(decorate) }));

  // team-level groups for what-if clicks (a spread game's team = both of its margin buckets)
  const groups = {};
  for (const [ev, outs] of Object.entries(evOutcomes)) {
    if (!probs[ev]) continue;
    if (fineGroups[ev]) { groups[ev] = fineGroups[ev]; continue; }
    if (evKind[ev] === "binary") { groups[ev] = { yes: ["yes"], no: ["no"] }; continue; }
    const sp = spreadOf[ev];
    const teams = sp ? legEvent({ ticker: `${ev}-${sp.team}` }).outcomes : outs;
    groups[ev] = Object.fromEntries(teams.map((t) => [t, sp && t === sp.team ? [`${t}>=${sp.k}`, `${t}<${sp.k}`] : [t]]));
  }
  const teamNames = {}; for (const [ev, g] of Object.entries(groups)) for (const t of Object.keys(g)) teamNames[`${ev}:${t}`] = evKind[ev] === "game" ? gameName(ev, t) : nameOf(ev, t);

  return {
    ...res, perEvent,
    top: res.top.map(decorate),
    baseWorst: res.worst,
    legs: Object.entries(legInfo).map(([k, f]) => ({ key: k, p: f.p, american: f.american, best: f.best, oppAmerican: f.oppAmerican })),
    locksPriced: priced.filter((x) => !x.single).length, locksTotal: parlays.length, unpriced, unpricedCount: unpricedLocks.length, unpricedReasons, skipped, resting,
    finals: finalEv, spreadGames: Object.keys(spreadOf), spreadClamps: clamps, notes,
    model: { finals: finalEv, positions: priced.map(({ id, legs, hit, miss, lineHedge, single }) => ({ id, legs: legs.map(({ event, kind, outcomes, allowed }) => ({ event, kind, outcomes, allowed })), hit, miss, ...(lineHedge ? { lineHedge: true } : {}), ...(single ? { single: true } : {}) })), probs, groups, teamNames, shown },
  };
}
