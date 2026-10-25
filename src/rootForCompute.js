// Glue: locks + live venue data → "What to root for" summary (pure; the API does the fetching).
import { legEvent, rootFor, NEITHER } from "./rootForEngine.js";
import { legFair, american } from "./rootForPrices.js";
import { lockPositions } from "./rootForLocks.js";
import { deskFillCounts, isConfirmedFillSubmission } from "./comboTape.js";

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
export function computeRootFor({ parlays = [], fills = [], singles = [], submissions = null, kalshiBooks = {}, relay = {}, starts = {}, now = Date.now(), kalshiAt = now, opts = {}, finals = {}, extraPositions = [], legFairFn = null }) {
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
      return { event: sp.game, kind: "game", outcomes: evOutcomes[sp.game], allowed: side === "no" ? [small, O] : [big], label: l.label, spread: true };
    }
    const r = legEvent(l);
    if (r.kind === "game") {
      if (r.allowed.length === 1) (mlHeld[r.event] = mlHeld[r.event] || new Set()).add(r.allowed[0]);
      const spd = spreadOf[r.event];
      if (spd) {
        const S = spd.team; const parts = { [S]: [`${S}>=${spd.k}`, `${S}<${spd.k}`] };
        const allowed = r.allowed.flatMap((o) => parts[o] || [o]);
        evOutcomes[r.event] = evOutcomes[r.event] || [`${S}>=${spd.k}`, `${S}<${spd.k}`, r.outcomes.find((x) => x !== S)]; evKind[r.event] = "game";
        return { event: r.event, kind: "game", outcomes: evOutcomes[r.event], allowed, label: l.label };
      }
      evOutcomes[r.event] = evOutcomes[r.event] || [...r.outcomes]; evKind[r.event] = "game";
      return { event: r.event, kind: "game", outcomes: evOutcomes[r.event], allowed: r.allowed, label: l.label };
    }
    evOutcomes[r.event] = ["yes", "no"]; evKind[r.event] = "binary";
    if (l.label) names[`${r.event}:${r.allowed[0]}`] = l.label + (side === "no" ? " (No)" : "");
    return { ...r, label: l.label };
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

  // ---- 3. raw inverse chances per event (no scaling); residual "neither" keeps sides exclusive
  const probs = {}; const shown = {}; const unpricedEv = new Set(); const clamps = []; const finalEv = {};
  // finished game (no live price): count it at its final result (1 = winner, 0 = rest) instead of dropping its locks
  const settle = (ev, outs) => { const w = finalOutcome(finals[ev], outs); if (w == null) return false; probs[ev] = Object.fromEntries(outs.map((o) => [o, o === w ? 1 : 0])); finalEv[ev] = w; return true; };
  for (const [ev, outs] of Object.entries(evOutcomes)) {
    if (evKind[ev] === "binary") {
      const held = new Set(); for (const pos of resolved) for (const l of pos.legs) if (l.event === ev) held.add(l.allowed[0]);
      const py = held.has("yes") ? fair(ev, "yes").p : null; const pn = held.has("no") ? fair(ev, "no").p : null;
      if (py == null && pn == null) { if (!settle(ev, outs)) unpricedEv.add(ev); continue; }
      probs[ev] = py != null && pn != null ? (py + pn > 1 ? { yes: py / (py + pn), no: pn / (py + pn), [NEITHER]: 0 } : { yes: py, no: pn, [NEITHER]: 1 - py - pn }) : py != null ? { yes: py, no: 1 - py } : { yes: 1 - pn, no: pn };
      continue;
    }
    const teams = (() => { const sp = spreadOf[ev]; if (!sp) return outs; const r = legEvent({ ticker: `${ev}-${sp.team}` }); return r.outcomes; })();
    const [a, b] = teams; const held = mlHeld[ev] || new Set();
    const ra = fair(`${ev}-${a}`, "yes").p, rb = fair(`${ev}-${b}`, "yes").p;
    let pa, pb, pn = 0;
    if (held.has(a) && held.has(b) && ra != null && rb != null) { const z = ra + rb; if (z > 1) { pa = ra / z; pb = rb / z; } else { pa = ra; pb = rb; pn = 1 - z; } } // both sides held: crossed/stale books summing past 100% are scaled to 100%
    else if (held.has(b) && !held.has(a) && rb != null) { pb = rb; pa = 1 - rb; }
    else if (ra != null) { pa = ra; pb = 1 - ra; }
    else if (rb != null) { pb = rb; pa = 1 - rb; }
    else { if (!settle(ev, outs)) unpricedEv.add(ev); continue; }
    shown[`${ev}:${a}`] = pa; shown[`${ev}:${b}`] = pb;
    const sp = spreadOf[ev];
    if (!sp) { probs[ev] = { [a]: pa, [b]: pb, ...(pn > 0 ? { [NEITHER]: pn } : {}) }; continue; }
    const S = sp.team, O = teams.find((x) => x !== S); const pS = S === a ? pa : pb, pO = S === a ? pb : pa;
    let big;
    if (sp.sides.has("yes")) { const y = fair(sp.ticker, "yes").p; big = y; }
    if (big == null && sp.sides.has("no")) { const n = fair(sp.ticker, "no").p; if (n != null) big = pS - (n - pO); }
    if (big == null) { if (!settle(ev, outs)) unpricedEv.add(ev); continue; }
    if (big > pS || big < 0) { clamps.push(ev); big = Math.min(pS, Math.max(0, big)); }
    probs[ev] = { [`${S}>=${sp.k}`]: big, [`${S}<${sp.k}`]: pS - big, [O]: pO, ...(pn > 0 ? { [NEITHER]: pn } : {}) };
    shown[`${ev}:${S}>=${sp.k}`] = big;
  }
  // a lock needs every event priced
  const priced = []; const unpriced = [];
  for (const pos of resolved) { const bad = pos.legs.find((l) => unpricedEv.has(l.event)); if (bad) unpriced.push({ id: pos.id, label: pos.label, leg: bad.label || bad.event, hit: pos.hit, miss: pos.miss }); else priced.push(pos); }

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
    locksPriced: priced.filter((x) => !x.single).length, locksTotal: parlays.length, unpriced, skipped, resting,
    finals: finalEv, spreadGames: Object.keys(spreadOf), spreadClamps: clamps, notes,
    model: { finals: finalEv, positions: priced.map(({ id, legs, hit, miss }) => ({ id, legs: legs.map(({ event, kind, outcomes, allowed }) => ({ event, kind, outcomes, allowed })), hit, miss })), probs, groups, teamNames, shown },
  };
}
