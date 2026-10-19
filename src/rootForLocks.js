// Real per-lock P&L for "What to root for": sportsbook payout + sold hedge contracts at their real
// fill prices, fees included (same receipt math as the Statement: lockFillReceipt).
import { bookPnL, lockKind } from "./comboLockProfile.js";
import { lockFillReceipt } from "./comboStatement.js";
import { isLockCapFill } from "./comboTape.js";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (x) => Math.round(x * 100) / 100;

/** parlay row + its combo_fills + combo_single_orders → positions for the engine. */
// filledCount: History P/L's contract count (deskFillCounts: deduped fills + confirmed submissions); else raw sum.
export function lockPositions(parlay, fills = [], singles = [], filledCount = null) {
  const book = bookPnL({ stake: parlay.parlay_stake, american: parlay.parlay_american, kind: lockKind(parlay) });
  if (!book) return { skip: "no stake / odds" };
  const mine = (fills || []).filter((f) => f && f.parlay_id === parlay.id && f.is_combo !== false && isLockCapFill(f));
  const filled = num(filledCount) != null ? num(filledCount) : mine.reduce((a, f) => a + (num(f.count) || 0), 0);
  const rec = filled > 0 ? lockFillReceipt(parlay, mine, filled) : { received: 0, fees: 0, ok: true };
  const received = rec.ok ? rec.received : 0;
  const legs = (parlay.legs || []).map((l) => ({ ticker: l.ticker, side: l.side || "yes", label: l.label, game: l.game, type: l.type }));
  const out = [{
    id: parlay.id, label: parlay.label, legs, kind: book.kind,
    stake: book.stake, american: book.american, filled: r2(filled), received: r2(received), fees: r2(rec.fees || 0),
    hit: r2(book.bookHit + received - filled), miss: r2(book.bookMiss + received),
  }];
  // Single-leg hedges (per-leg orders): their own position on that leg's market.
  let resting = 0;
  // A single order whose fills are already recorded as this lock's fills (single-leg locks, mirrored "sl-" fills
  // on the same market) is the same contracts: counting it again double-counted (22268b2b +$42.90 vs History +$8.74).
  const mirrored = (o) => (parlay.legs || []).length === 1 || mine.some((f) => f.ticker && f.ticker === o.market);
  for (const o of singles || []) {
    if (!o || o.parlay_id !== parlay.id) continue;
    resting += num(o.open) || 0;
    if (mirrored(o)) continue;
    const f = num(o.filled) || 0; const px = num(o.price);
    if (!(f > 0) || px == null) continue;
    const pr = px > 1 ? px / 100 : px;
    out.push({ id: `${parlay.id}:${o.order_id || o.id}`, label: `${parlay.label} · single hedge ${o.hedge} ${o.market}`, legs: [{ ticker: o.market, side: o.hedge || "no" }], single: true, hit: r2(f * (1 - pr)), miss: r2(-f * pr) });
  }
  out[0].resting = r2(resting);
  return { positions: out };
}
