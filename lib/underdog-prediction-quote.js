'use strict';

// CJS copy of the phone-price parser in src/underdogPredictionQuote.js.
//
// api/ and lib/ are CommonJS. package.json "type":"module" makes src/*.js
// ESM, and Vercel Node rejects require() of that file (ERR_REQUIRE_ESM)
// before the route handler runs. This module has no import/export and no
// dependency on src/. Keep the quote rules in lockstep with the ESM file:
// odds.prediction only, never odds.fantasy, never a scaffold section.

const SIDE_CHOICES = new Set(['higher', 'lower', 'yes', 'no', 'over', 'under']);

function decimalToAmerican(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 1) return null;
  if (n >= 2) return Math.round((n - 1) * 100);
  return -Math.round(100 / (n - 1));
}

function parseAmerican(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0 ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s.replace(/^\+/, '').replace(/,/g, ''));
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

function spreadPointFromOption(line, opt) {
  const display = [opt && opt.choice_display, opt && opt.choice_display_name].filter(Boolean).join(' ');
  const signed = display.match(/([+-]\d+(?:\.\d+)?)/);
  if (signed) return parsePoint(signed[1]);
  return parsePoint(line && line.stat_value);
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
  ].filter((v) => typeof v === 'string' && v).join(' ').toLowerCase();
}

function classifyUnderdogLineMarket(line, groupName) {
  const text = textOf(line, groupName);
  if (/future|champion|mvp|playoff|award|division winner|cy young|rookie of the year|offensive player|coach of the year/.test(text)) {
    return 'future';
  }
  const cat = String(((line && line.over_under) || {}).category || (line && line.category) || '').toLowerCase();
  if (cat === 'future') return 'future';
  if (/moneyline|money line|\bml\b|to win|game winner|match winner/.test(text)) return 'h2h';
  if (/spread|run line|puck line|handicap|point spread/.test(text)) return 'spreads';
  if (/team total/.test(text)) return 'team_total';
  if (/\btotal\b|over\/under|game total/.test(text)) return 'totals';
  return null;
}

function optionName(opt) {
  const choice = String(opt.choice || '').toLowerCase();
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
    if (typeof c !== 'string') continue;
    const name = c.trim();
    if (!name || SIDE_CHOICES.has(name.toLowerCase())) continue;
    return name;
  }
  if (genericChoice) return choice;
  return null;
}

function parseUpdatedAt(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function predictionQuoteFromOption(opt) {
  if (!opt || typeof opt !== 'object') return null;
  const pred = opt.odds && opt.odds.prediction;
  if (!pred || typeof pred !== 'object') return null;
  let american = parseAmerican(pred.american);
  if (american == null) american = parseAmerican(opt.american_price);
  let decimal = Number(pred.decimal);
  if (!Number.isFinite(decimal) || decimal <= 1) decimal = Number(opt.decimal_price);
  if (!Number.isFinite(decimal) || decimal <= 1) decimal = null;
  if (american == null && decimal != null) american = decimalToAmerican(decimal);
  if (american == null) return null;
  // Per-side quote clock. Live lines stamp the option (Miami match 183027
  // updated_at 2026-09-13 while Central Michigan on the same game is fresh).
  // Prefer odds.prediction.updatedAt when the payload nests the clock there.
  return {
    american,
    decimal,
    probability: parseUnitProbability(pred.probability),
    updatedAt: parseUpdatedAt(
      (pred.updatedAt || pred.updated_at) || opt.updated_at || opt.updatedAt,
    ),
  };
}

function labelOf(node, fallback) {
  if (!node || typeof node !== 'object') return fallback || '';
  for (const key of ['title', 'name', 'group', 'display_stat', 'market_type', 'bet_type']) {
    if (typeof node[key] === 'string' && node[key].trim()) return node[key].trim();
  }
  return fallback || '';
}

function collectLines(payload) {
  const lines = [];
  const visit = (node, groupName) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, groupName);
      return;
    }
    const label = labelOf(node, groupName);
    if (Array.isArray(node.options) && node.options.length) {
      lines.push({ line: node, groupName: label });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'options' || key === 'odds' || key === 'experiments') continue;
      if (value && typeof value === 'object') visit(value, label);
    }
  };
  visit(payload, '');
  return lines;
}

function predictionQuotesFromPayload(payload) {
  if (!payload) return [];
  const out = [];
  const seen = new Set();
  for (const { line, groupName } of collectLines(payload)) {
    const market = classifyUnderdogLineMarket(line, groupName);
    for (const opt of line.options) {
      const quote = predictionQuoteFromOption(opt);
      if (!quote) continue;
      const name = optionName(opt);
      if (!name) continue;
      let point = null;
      if (market === 'spreads') point = spreadPointFromOption(line, opt);
      else if (market === 'totals' || market === 'team_total') point = parsePoint(line.stat_value);
      const row = {
        name,
        american: quote.american,
        decimal: quote.decimal,
        probability: quote.probability,
        market,
        choice: opt.choice || null,
        point,
        updatedAt: quote.updatedAt || null,
      };
      const key = `${row.market}|${row.name}|${row.american}|${row.point ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

module.exports = {
  classifyUnderdogLineMarket,
  predictionQuoteFromOption,
  predictionQuotesFromPayload,
};
