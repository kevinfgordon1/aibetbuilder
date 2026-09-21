// Underdog first-party prediction prices (the phone), distinct from
// odds.fantasy and from Betstamp book 196.
//
// Live capture, match_id 178911 (NYG @ LAR), logged-in scaffold:
//   Giants odds.prediction { american:+245, decimal:3.45, probability:27 }
//   Rams   odds.prediction { american:-313, decimal:1.32, probability:74 }
//   Top-level american_price / decimal_price matched those prediction
//   fields. That is the app (3.45x / +245), not the gross sticker
//   (+252 / 3.52). Prefer odds.prediction.american. Use american_price
//   only when a prediction object is present and its american is blank.
//   Never read odds.fantasy for Promo cash.
//
// Anonymous probe (no Authorization, no cookies):
//   GET /v1/lobbies/scaffolds/matches?include_prediction_markets=true
//       &market_view=compact&match_id=178911&match_type=Game&product=fantasy
//     → 400 until state_config_id is set. A fake UUID 404s (the id is
//       looked up) without asking for a session. A fake
//       product_experience_id 400s even with product=fantasy.
//   GET /v1/user → 401. GET /v1/geo_comply/license and
//       /beta/v5/over_under_lines → 426 upgrade_required. A date-shaped
//       Client-Version still 426s, so a current app build is required
//       before geo can mint state_config_id.
//   GET /v1/over_under_lines?include_prediction_markets=true&product=fantasy
//     → 200 with no Client-Version and no state_config_id. odds.prediction
//       is filled for futures (american_price matches prediction.american;
//       odds.fantasy is null). Game moneylines are not in that payload
//       (178911 is player props; prediction is null without the flag).
//       match_id on that URL is ignored.
//
// Game-moneyline app prices therefore are not durably anonymous. Promo
// does not log in. Cash uses a joined prediction quote when one is
// supplied, and otherwise the Betstamp sticker plus the Kalshi-style
// r=0.1015 fallback. Free bets stay on the gross sticker. A prediction
// quote with no sticker is not turned into a leg: free bets settle at
// gross, and the phone price is not that gross.

import { teamsLikelySame } from "./promoBookmaker.js";
import { UNDERDOG_PREDICT_BOOK_KEY } from "./betstampBooks.js";

const SIDE_CHOICES = new Set(["higher", "lower", "yes", "no", "over", "under"]);

function decimalToAmerican(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 1) return null;
  if (n >= 2) return Math.round((n - 1) * 100);
  return -Math.round(100 / (n - 1));
}

function parseAmerican(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw !== 0 ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/^\+/, "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  // 3.45 is a decimal price, not American +3.
  if (/[.]/.test(s) && Math.abs(n) < 50) return null;
  return n;
}

function parseUnitProbability(raw) {
  let p = Number(raw);
  if (!Number.isFinite(p)) return null;
  if (p > 1 && p <= 100) p = p / 100;
  if (!(p > 0 && p < 1)) return null;
  return p;
}

function parsePoint(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function textOf(line, groupName) {
  const ou = (line && line.over_under) || {};
  const ast = ou.appearance_stat || (line && line.appearance_stat) || {};
  return [
    groupName,
    ou.title,
    line && line.title,
    ou.category,
    line && line.category,
    ast.display_stat,
    ast.stat,
    ou.display_mode,
  ].filter((v) => typeof v === "string" && v).join(" ").toLowerCase();
}

export function classifyUnderdogLineMarket(line, groupName) {
  const text = textOf(line, groupName);
  if (/future|champion|mvp|playoff|award|division winner|cy young|rookie of the year|offensive player|coach of the year/.test(text)) {
    return "future";
  }
  const cat = String(((line && line.over_under) || {}).category || (line && line.category) || "").toLowerCase();
  if (cat === "future") return "future";
  if (/moneyline|money line|\bml\b|to win|game winner|match winner/.test(text)) return "h2h";
  if (/spread|run line|puck line|handicap|point spread/.test(text)) return "spreads";
  if (/team total/.test(text)) return "team_total";
  if (/\btotal\b|over\/under|game total/.test(text)) return "totals";
  return null;
}

function optionName(opt) {
  const choice = String(opt.choice || "").toLowerCase();
  const genericChoice = SIDE_CHOICES.has(choice);
  const candidates = [
    opt.selection_header,
    opt.choice_display,
    opt.choice_display_name,
    genericChoice ? null : opt.choice,
    opt.name,
    opt.team_name,
    opt.competitor,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const name = c.trim();
    if (!name || SIDE_CHOICES.has(name.toLowerCase())) continue;
    return name;
  }
  if (genericChoice) return choice;
  return null;
}

// Null when odds.prediction is absent. Fantasy american_price is not a
// prediction quote (public props print american_price −167 with
// odds.fantasy −186 and odds.prediction null).
export function predictionQuoteFromOption(opt) {
  if (!opt || typeof opt !== "object") return null;
  const pred = opt.odds && opt.odds.prediction;
  if (!pred || typeof pred !== "object") return null;
  let american = parseAmerican(pred.american);
  if (american == null) american = parseAmerican(opt.american_price);
  let decimal = Number(pred.decimal);
  if (!Number.isFinite(decimal) || decimal <= 1) decimal = Number(opt.decimal_price);
  if (!Number.isFinite(decimal) || decimal <= 1) decimal = null;
  if (american == null && decimal != null) american = decimalToAmerican(decimal);
  if (american == null) return null;
  return {
    american,
    decimal,
    probability: parseUnitProbability(pred.probability),
  };
}

function labelOf(node, fallback) {
  if (!node || typeof node !== "object") return fallback || "";
  for (const key of ["title", "name", "group", "display_stat", "market_type", "bet_type"]) {
    if (typeof node[key] === "string" && node[key].trim()) return node[key].trim();
  }
  return fallback || "";
}

function collectLines(payload) {
  const lines = [];
  const visit = (node, groupName) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, groupName);
      return;
    }
    const label = labelOf(node, groupName);
    if (Array.isArray(node.options) && node.options.length) {
      lines.push({ line: node, groupName: label });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "options" || key === "odds" || key === "experiments") continue;
      if (value && typeof value === "object") visit(value, label);
    }
  };
  visit(payload, "");
  return lines;
}

export function predictionQuotesFromPayload(payload) {
  if (!payload) return [];
  const out = [];
  const seen = new Set();
  for (const { line, groupName } of collectLines(payload)) {
    const market = classifyUnderdogLineMarket(line, groupName);
    const point = market === "spreads" || market === "totals" || market === "team_total"
      ? parsePoint(line.stat_value)
      : null;
    for (const opt of line.options) {
      const quote = predictionQuoteFromOption(opt);
      if (!quote) continue;
      const name = optionName(opt);
      if (!name) continue;
      const row = {
        name,
        american: quote.american,
        decimal: quote.decimal,
        probability: quote.probability,
        market,
        choice: opt.choice || null,
        point,
      };
      const key = `${row.market}|${row.name}|${row.american}|${row.point ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function namesMatch(a, b) {
  if (!a || !b) return false;
  if (String(a).trim().toLowerCase() === String(b).trim().toLowerCase()) return true;
  return teamsLikelySame(a, b);
}

function quoteMatchesOutcome(quote, outcome, marketKey, away, home) {
  if (!quote || quote.market === "future") return false;
  if (quote.market && quote.market !== marketKey) return false;
  if (quote.market == null) {
    if (marketKey !== "h2h") return false;
    const choice = String(quote.choice || "").toLowerCase();
    if (SIDE_CHOICES.has(choice)) return false;
    if (!(namesMatch(quote.name, away) || namesMatch(quote.name, home))) return false;
  }
  if (quote.point != null && outcome.point != null && Number(quote.point) !== Number(outcome.point)) return false;
  return namesMatch(quote.name, outcome.name);
}

function attachQuote(outcome, marketKey, quotes, away, home) {
  if (!outcome || outcome.price == null || !outcome.name) return outcome;
  const hit = quotes.find((q) => quoteMatchesOutcome(q, outcome, marketKey, away, home));
  if (!hit) return outcome;
  const next = { ...outcome, predictionAmerican: hit.american };
  if (hit.probability != null) next.contractProbability = hit.probability;
  return next;
}

// Sticker stays on outcome.price. predictionAmerican is the cash phone
// price. No Underdog bookmaker → game unchanged (prediction-only is not
// a free-bet or cash leg).
export function applyUnderdogLobbyPredictions(game, payload) {
  if (!game || typeof game !== "object" || !payload) return game;
  const quotes = Array.isArray(payload) ? payload : predictionQuotesFromPayload(payload);
  if (!quotes.length) return game;
  const away = game.away_team;
  const home = game.home_team;
  let touched = false;
  const bookmakers = (game.bookmakers || []).map((bm) => {
    if (!bm || bm.key !== UNDERDOG_PREDICT_BOOK_KEY) return bm;
    touched = true;
    return {
      ...bm,
      markets: (bm.markets || []).map((market) => ({
        ...market,
        outcomes: (market.outcomes || []).map((outcome) => attachQuote(outcome, market.key, quotes, away, home)),
      })),
    };
  });
  if (!touched) return game;
  return { ...game, bookmakers };
}
