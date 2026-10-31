// NCAAM Champion view (Kevin Oct 30 2026). Pure, node-testable.
// One row per team:
//   best Yes      = best fee-in American across every sportsbook + Kalshi + Polymarket US (selected books only)
//   best opposing = best fee-in "will NOT win" price, Kalshi / Polymarket US only (books sell no No side)
//   fair (inverse-bet method) = 1 - implied prob of the best opposing price; EV% of the best Yes against it
//   depth         = potential profit at the top-of-book price (server-computed, fee in); never invented.
export const NCAAM_CHAMP_KEY = "basketball_ncaab_championship_winner";
export const OPPOSING_VENUES = Object.freeze(["kalshi", "polymarket"]);

export function impliedProb(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a < 0 ? -a / (-a + 100) : 100 / (a + 100);
}

export function probToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

function decimalOf(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
}

function best(priceMap, allowed) {
  let price = null;
  let books = [];
  for (const [key, raw] of Object.entries(priceMap || {})) {
    if (allowed && !allowed(key)) continue;
    const p = Number(raw);
    if (!Number.isFinite(p)) continue;
    if (price == null || p > price) { price = p; books = [key]; } else if (p === price) books.push(key);
  }
  return { price, books };
}

// teams: transformFuturesData(...).teams; selected: Set of book keys (null = all).
export function ncaamChampionRows(teams, { selected = null, search = "" } = {}) {
  const ok = (key) => !selected || selected.has(key);
  const q = String(search || "").trim().toLowerCase();
  const rows = [];
  for (const t of teams || []) {
    if (!t || !t.name || (q && !t.name.toLowerCase().includes(q))) continue;
    const yes = best(t.books, ok);
    const no = best(t.noBooks, (key) => OPPOSING_VENUES.includes(key) && ok(key));
    if (yes.price == null && no.price == null) continue;
    const pNo = impliedProb(no.price);
    const fair = pNo != null ? 1 - pNo : null;
    const dec = decimalOf(yes.price);
    const evPct = fair != null && dec != null ? (fair * dec - 1) * 100 : null;
    const profitOf = (map, keys) => {
      const vals = (keys || []).map((k) => Number(map && map[k])).filter((v) => Number.isFinite(v) && v > 0);
      return vals.length ? Math.max(...vals) : null;
    };
    rows.push({
      name: t.name,
      yes: yes.price,
      yesBooks: yes.books,
      yesProfit: profitOf(t.bookProfits, yes.books),
      no: no.price,
      noBooks: no.books,
      noProfit: profitOf(t.noBookProfits, no.books),
      fairProb: fair,
      fairAmerican: fair != null ? probToAmerican(fair) : null,
      evPct: evPct != null ? Math.round(evPct * 10) / 10 : null,
    });
  }
  return rows.sort((a, b) => (impliedProb(b.yes) ?? 0) - (impliedProb(a.yes) ?? 0));
}

export function fmtProfit(v) {
  if (!(Number(v) > 0)) return "—";
  const n = Number(v);
  return n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`;
}
