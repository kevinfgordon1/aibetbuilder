// Plain-English sniper legs: "Patriots ML · NE @ CHI · Thu 8:15 PM",
// "Drew Ogletree anytime TD (No) · IND @ TEN · Sun 1:00 PM". Games: "NE @ CHI · Thu 8:15 PM".
// Kickoffs/team names come from the ESPN scoreboard (keyed by Kalshi game code, e.g. 26OCT22NECHI).

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// ESPN abbreviation -> Kalshi abbreviation where they differ.
const ALIAS = { WSH: "WAS", JAX: "JAC" };
const kcode = (a) => ALIAS[String(a || "").toUpperCase()] || String(a || "").toUpperCase();

// ISO kickoff -> Kalshi date prefix in ET ("26OCT25").
export function etDateCode(iso) {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return null;
  const [y, m, day] = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).split("-");
  return `${y.slice(2)}${MON[Number(m) - 1]}${day}`;
}
export function fmtKick(iso) {
  const d = new Date(iso); if (!iso || !Number.isFinite(d.getTime())) return null;
  return d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "");
}

// ESPN scoreboard JSON(s) -> { "26OCT22NECHI": { away, home, awayName, homeName, kickoff } }
export function gamesFromEspn(boards) {
  const out = {};
  for (const b of [].concat(boards || [])) {
    for (const e of (b && b.events) || []) {
      const c = (e.competitions && e.competitions[0] && e.competitions[0].competitors) || [];
      const h = c.find((x) => x.homeAway === "home"); const a = c.find((x) => x.homeAway === "away");
      if (!h || !a || !e.date) continue;
      const away = kcode(a.team && a.team.abbreviation); const home = kcode(h.team && h.team.abbreviation);
      const code = `${etDateCode(e.date)}${away}${home}`;
      out[code] = { away, home, awayName: (a.team && (a.team.shortDisplayName || a.team.name)) || away, homeName: (h.team && (h.team.shortDisplayName || h.team.name)) || home, kickoff: e.date };
    }
  }
  return out;
}

const gameCodeOf = (key) => { const p = String(key || "").split(":")[0].toUpperCase().split("-"); return p.length >= 2 ? p[1] : p[0]; };
const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();

// "26OCT22NECHI" | "KXNFLGAME-26OCT22NECHI" -> "NE @ CHI · Thu 8:15 PM"
export function gameLabel(gameKey, games = {}) {
  const code = gameCodeOf(gameKey); const g = games[code];
  if (g) { const k = fmtKick(g.kickoff); return `${g.away} @ ${g.home}${k ? ` · ${k}` : ""}`; }
  const m = /^\d{2}[A-Z]{3}\d{2}([A-Z]+)$/.exec(code);
  return m ? m[1] : String(gameKey || "");
}

// leg key "KXNFLGAME-26OCT22NECHI-NE:yes" -> { bet, game, kickoff, text }
export function legInfo(key, games = {}, names = {}) {
  const [tRaw, sideRaw] = String(key || "").split(":"); const t = tRaw.toUpperCase(); const side = (sideRaw || "yes").toLowerCase();
  const p = t.split("-"); const code = p[1] || ""; const g = games[code];
  const no = side === "no" ? " (No)" : "";
  let bet;
  if (t.startsWith("KXNFLTD")) {
    const pc = p[2] || "";
    let who = names[t] ? String(names[t]).split(":")[0].replace(/\s*(anytime|to score).*$/i, "").trim() : null;
    if (!who) { const m = /^[A-Z]{2,3}([A-Z])([A-Z]+?)\d*$/.exec(pc); who = m ? `${m[1]}. ${title(m[2])}` : pc; }
    bet = `${who} anytime TD${no}`;
  } else {
    const pick = p[2] || "";
    const nm = g ? (pick === g.away ? g.awayName : pick === g.home ? g.homeName : pick) : pick;
    bet = `${nm} ML${no}`;
  }
  const game = gameLabel(code, games);
  return { bet, game, kickoff: g ? g.kickoff : null, text: `${bet} · ${game}` };
}

// Unique ET game dates (YYYYMMDD) for ESPN fetches from leg / game keys.
export function espnDates(keys) {
  const out = new Set();
  for (const k of keys || []) {
    const m = /^(\d{2})([A-Z]{3})(\d{2})/.exec(gameCodeOf(k));
    if (m && MON.includes(m[2])) out.add(`20${m[1]}${String(MON.indexOf(m[2]) + 1).padStart(2, "0")}${m[3]}`);
  }
  return [...out].sort();
}
