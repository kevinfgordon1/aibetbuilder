// One-shot generator for public/book-logos/*.svg — run from repo root.
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "public/book-logos");
fs.mkdirSync(DIR, { recursive: true });

function svg(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">${inner}</svg>\n`;
}

function bg(fill, rx = 6) {
  return `<rect width="32" height="32" rx="${rx}" fill="${fill}"/>`;
}

function letters(text, fill, size = 13) {
  return `<text x="16" y="21.2" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="800" fill="${fill}">${text}</text>`;
}

const files = {};

// FanDuel — official app-icon style: blue field, white heater shield, blue F, left split.
files.fanduel = svg(
  `${bg("#1493FF")}
  <path fill="#fff" d="M16.2 4.4c-2.6 0-7.4 2.1-7.4 2.1v9.8c0 6.4 6.1 10.8 7.2 11.5.3.2.7.2 1 0 1.1-.7 7.2-5.1 7.2-11.5V6.5S18.8 4.4 16.2 4.4z"/>
  <path fill="#1493FF" d="M11.2 7.2l1.9 5.1-1.4 2.6 1.6 4.8-2.1-1.4V8z"/>
  <path fill="#1493FF" d="M14.1 11.1h5.4c.25 0 .45.2.45.45v1.15c0 .25-.2.45-.45.45h-3.35v1.55h3c.25 0 .45.2.45.45v1.1c0 .25-.2.45-.45.45h-3v2.35c0 .25-.2.45-.45.45h-1.35c-.25 0-.45-.2-.45-.45v-7.5c0-.25.2-.45.45-.45z"/>`,
);

// DraftKings — official-style green field + crown (the sportsbook app mark).
files.draftkings = svg(
  `${bg("#53D337")}
  <path fill="#111" d="M6.2 20.6h19.6v3.1H6.2zm.9-1.3 3.5-8.4 5.4 6.1 5.4-6.1 3.5 8.4H7.1z"/>
  <circle cx="8.4" cy="10.2" r="1.45" fill="#111"/>
  <circle cx="16" cy="7.8" r="1.45" fill="#111"/>
  <circle cx="23.6" cy="10.2" r="1.45" fill="#111"/>`,
);

// Caesars Sportsbook — gold field, dark C.
files.williamhill_us = svg(`${bg("#D4A843")}${letters("C", "#1A1408", 18)}`);

// Pinnacle — dark field, gold P (sportsbook colors; not the video-company mark).
files.pinnacle = svg(`${bg("#1A1608")}${letters("P", "#E4C04A", 18)}`);

// BetOnline — official green, white B.
files.betonlineag = svg(`${bg("#0A8F5A")}${letters("B", "#fff", 18)}`);

// BetCris — amber field, dark b (their wordmark lead letter).
files.betcris = svg(`${bg("#F59E0B")}${letters("b", "#1A1200", 20)}`);

// Circa Sports — gold disc + C (circular house mark).
files.circa = svg(
  `<rect width="32" height="32" rx="6" fill="#111"/>
  <circle cx="16" cy="16" r="11.2" fill="#EAB308"/>
  <text x="16" y="21.4" text-anchor="middle" font-family="Georgia,Times,serif" font-size="16" font-weight="700" fill="#111">C</text>`,
);

// bet365 — official green + yellow 365 (Wikimedia PD-textlogo colors).
files.bet365 = svg(`${bg("#027B5B")}${letters("365", "#F9DC1C", 12)}`);

// ProphetX — rose field, white X (exchange mark).
files.prophetx = svg(
  `${bg("#F43F5E")}
  <path fill="#fff" d="M9.2 8.4h3.1l3.7 5.2 3.7-5.2h3.1l-5.2 7.2 5.4 8h-3.2l-3.8-5.6-3.8 5.6H9l5.4-8z"/>`,
);

// Polymarket — official card/bars icon (Wikimedia File:Polymarket.svg), on brand blue.
files.polymarket = svg(
  `${bg("#2D5BFF")}
  <g fill="#fff" transform="translate(7.2,5.2) scale(0.132)">
    <path d="M136.267 152.495C136.267 159.76 136.267 163.392 133.891 165.192C131.516 166.993 128.019 166.012 121.024 164.049L8.63192 132.51C4.41793 131.328 2.31093 130.737 1.09248 129.129C-0.125977 127.522 -0.125977 125.333 -0.125977 120.957V47.0434C-0.125977 42.6667 -0.125977 40.4783 1.09248 38.8709C2.31093 37.2634 4.41792 36.6722 8.63191 35.4897L121.024 3.95096C128.019 1.98834 131.516 1.00703 133.891 2.80771C136.267 4.60839 136.267 8.24049 136.267 15.5047V152.495ZM27.9043 122.228L120.966 148.345V96.1133L27.9043 122.228ZM15.1738 110.111L108.217 84L15.1738 57.8887V110.111ZM27.9033 45.7725L120.966 71.8877V19.6553L27.9033 45.7725Z"/>
  </g>`,
);

// Kalshi — mint field + official K letterform (Wikimedia File:Kalshi logo.svg).
files.kalshi = svg(
  `${bg("#00C896")}
  <g fill="#111" transform="translate(7.4,6.2) scale(0.95)">
    <path d="M0.42 0.02H4.74V8.99L12.82 0.02H18.06L10.65 8.25L18.54 20H13.36L7.60 11.57L4.74 14.75V20H0.42V0.02Z"/>
  </g>`,
);

// BetMGM — black + gold MGM (lion detail does not read at 14px).
files.betmgm = svg(`${bg("#111")}${letters("MGM", "#C4A962", 10)}`);

// BetRivers — blue field, white R.
files.betrivers = svg(`${bg("#1D6FE5")}${letters("R", "#fff", 18)}`);

// Fanatics — official red flame-F (Wikimedia File:Fanatics company logo.svg color #E53D2E).
files.fanatics = svg(
  `${bg("#E53D2E")}
  <path fill="#fff" d="M10.2 22.8V9.1c0-.4.3-.7.7-.7h8.4c.3 0 .5.3.4.6-.3 1.2-1.4 2.1-2.7 2.1h-3.2v2.6h4.4c.3 0 .5.3.4.6-.2.9-1 1.5-1.9 1.5h-2.9v7h-3.6z"/>
  <path fill="#fff" d="M18.8 8.2c1.6-1.2 3.6-1.6 5.4-1.1.2.1.3.3.2.5l-1.1 2.2c-.1.2-.3.2-.5.1-1.1-.4-2.3-.2-3.2.5-.2.15-.5 0-.5-.25V8.45c0-.1.05-.2.15-.25z"/>`,
);

// Hard Rock Bet — gold disc + HR (circle is the house mark; guitar is unreadable at 14px).
files.hardrockbet = svg(
  `<rect width="32" height="32" rx="6" fill="#1A1408"/>
  <circle cx="16" cy="16" r="11.2" fill="#D4AF37"/>
  <text x="16" y="21" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="800" fill="#1A1408">HR</text>`,
);

// theScore Bet (espnbet key) — orange field, white S.
files.espnbet = svg(`${bg("#FF6600")}${letters("S", "#fff", 18)}`);

// Bovada — orange field, white B.
files.bovada = svg(`${bg("#F97316")}${letters("B", "#fff", 18)}`);

// MyBookie — amber field, dark M.
files.mybookieag = svg(`${bg("#F59E0B")}${letters("M", "#1A1200", 17)}`);

// LowVig — purple field, white LV.
files.lowvig = svg(`${bg("#8B5CF6")}${letters("LV", "#fff", 13)}`);

// BetUS — blue field, white US.
files.betus = svg(`${bg("#3B82F6")}${letters("US", "#fff", 13)}`);

// BetAnything — teal field, white BA.
files.betanysports = svg(`${bg("#14B8A6")}${letters("BA", "#fff", 13)}`);

// Novig — purple field, white N.
files.novig = svg(`${bg("#A855F7")}${letters("N", "#fff", 18)}`);

// BetOpenly — magenta field, white BO.
files.betopenly = svg(`${bg("#C026D3")}${letters("BO", "#fff", 12)}`);

for (const [key, body] of Object.entries(files)) {
  const dest = path.join(DIR, `${key}.svg`);
  fs.writeFileSync(dest, body);
  console.log(key, Buffer.byteLength(body));
}
console.log("wrote", Object.keys(files).length, "logos");
