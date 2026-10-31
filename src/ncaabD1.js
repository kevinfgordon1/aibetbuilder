// ESM twin of lib/ncaab-d1.js for the browser bundle (New Odds Board NCAAB D1-vs-D1 filter).
// Keep the two in sync; src/ncaabD1.test.js checks they agree on every name.
import { NCAAB_D1_TEAMS } from "./ncaabD1Teams.js";
// Canonical NCAAB team table (combo-worker ncaab-teams.json, synced by scripts/sync-ncaab-teams.cjs): every
// unambiguous known venue spelling -> ESPN id. Same normalization as lib/ncaab-teams.js (canonNorm below).
import { NCAAB_TEAM_NAMES } from "./ncaabTeamNames.js";

const CANON_WORD = { saint: 'st', state: 'st', mt: 'mount', univ: 'university', intl: 'international', u: 'university' };
export function canonNorm(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2018\u2019\u02bb`.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter((t) => t && t !== 'the').map((t) => CANON_WORD[t] || t).join(' ');
}
let CANON_BY_ID = null;


export function normName(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').map((t) => (t === 'st' ? 'state' : t)).join(' ');
}

// Kalshi / Underdog / Polymarket spelling -> ESPN location (normalized both sides). Only names that differ.
export const ALIASES = {
  'appalachian state': 'app state',
  'central connecticut state': 'central connecticut',
  'grambling state': 'grambling',
  liu: 'long island university',
  'long island': 'long island university',
  'louisiana monroe': 'ul monroe',
  'miami fl': 'miami',
  'miami florida': 'miami',
  'miami oh': 'miami oh',
  'miami ohio': 'miami oh',
  'new orleans': 'lsu new orleans',
  'queens university': 'queens university',
  queens: 'queens university',
  seattle: 'seattle u',
  'southern university': 'southern',
  'tennessee martin': 'ut martin',
  'usc upstate': 'south carolina upstate',
  'sc upstate': 'south carolina upstate',
  uconn: 'uconn',
  'connecticut': 'uconn',
  'ole miss': 'ole miss',
  'mississippi': 'ole miss',
  'nc state': 'nc state',
  'north carolina state': 'nc state',
  'texas a and m corpus christi': 'texas a and m corpus christi',
  'ualbany': 'ualbany',
  albany: 'ualbany',
  'university at albany': 'ualbany',
  'umass': 'massachusetts',
  'massachusetts lowell': 'umass lowell',
  'saint marys': 'saint marys',
  'st marys': 'saint marys',
  'saint marys ca': 'saint marys',
  'st johns': 'st johns',
  'saint johns': 'st johns',
  'loyola chicago': 'loyola chicago',
  'loyola il': 'loyola chicago',
  'southern miss': 'southern miss',
  'southern mississippi': 'southern miss',
  'utsa': 'utsa',
  'ut san antonio': 'utsa',
  'utep': 'utep',
  'ut el paso': 'utep',
  'unc wilmington': 'unc wilmington',
  'uncw': 'unc wilmington',
  'pitt': 'pittsburgh',
  'detroit': 'detroit mercy',
  'purdue fort wayne': 'purdue fort wayne',
  'fort wayne': 'purdue fort wayne',
  'iupui': 'iu indianapolis',
  'iu indy': 'iu indianapolis',
  'omaha': 'omaha',
  'nebraska omaha': 'omaha',
  'little rock': 'little rock',
  'arkansas little rock': 'little rock',
  'texas rio grande valley': 'ut rio grande valley',
  utrgv: 'ut rio grande valley',
  'cal state northridge': 'cal state northridge',
  csun: 'cal state northridge',
  'southeast missouri state': 'southeast missouri state',
  'semo': 'southeast missouri state',
  'texas a and m commerce': 'east texas a and m',
  'mcneese state': 'mcneese',
  'nicholls state': 'nicholls',
  'sam houston state': 'sam houston',
  'saint francis pa': 'saint francis',
  'st francis pa': 'saint francis',
  'st thomas minnesota': 'st thomas',
  'st thomas mn': 'st thomas',
  'william and mary': 'william and mary',
  'hawaii': 'hawaii',
  'k state': 'kansas state',
  'la tech': 'louisiana tech',
  'nm state': 'new mexico state',
  'southeastern louisiana': 'se louisiana',
};
// Keys and values go through normName too ("st" -> "state"), so "St. Thomas (MN)" finds 'st thomas mn'.
const ALIAS_N = new Map(Object.entries(ALIASES).map(([k, v]) => [normName(k), normName(v)]));

let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  const names = new Map();
  const abbrs = new Map();
  for (const t of NCAAB_D1_TEAMS) {
    for (const v of [t.location, t.short, t.display, t.location && t.name ? `${t.location} ${t.name}` : '']) {
      const n = normName(v);
      if (n && !names.has(n)) names.set(n, t);
    }
    if (t.abbr) abbrs.set(t.abbr, t);
  }
  INDEX = { names, abbrs };
  return INDEX;
}

// The D1 team for a display name ("Grambling St.", "Miami (FL)", "Villanova Wildcats"), or null.
export function d1Team(name) {
  const { names } = index();
  const n = normName(name);
  if (!n) return null;
  const direct = names.get(n) || names.get(ALIAS_N.get(n) || '');
  if (direct) return direct;
  // Canonical table (exact known spellings only; ambiguous names are not in the map -> null).
  const id = NCAAB_TEAM_NAMES[canonNorm(name)];
  if (id) {
    if (!CANON_BY_ID) CANON_BY_ID = new Map(NCAAB_D1_TEAMS.map((t) => [String(t.espnId), t]));
    return CANON_BY_ID.get(String(id)) || null;
  }
  return null;
}

export function isD1Team(name) {
  return !!d1Team(name);
}

// Both sides D1 (by name). Any unknown side = not D1-vs-D1.
export function isD1Game(away, home) {
  const a = d1Team(away);
  const h = d1Team(home);
  return !!(a && h && a.espnId !== h.espnId);
}
