'use strict';
// MLB on/off switch (Kevin Oct 30 2026: season over, turn off all baseball lines "for now").
// Default OFF: no Odds API baseball_mlb game-line / World Series futures / HR-prop pulls and
// no Underdog MLB index. Set Vercel env MLB_ENABLED=1 (and VITE_MLB_ENABLED=1 for the MLB /
// World Series tabs) and redeploy to bring MLB back. Nothing MLB-related was deleted.
const mlbOn = (env = process.env) => /^(1|true|yes|on)$/i.test(String((env && env.MLB_ENABLED) || '').trim());
const isMlbKey = (k) => /^(baseball_mlb|mlb)(_|$)/i.test(String(k || ''));
const withoutMlb = (list, env = process.env) => (mlbOn(env) ? list.slice() : list.filter((k) => !isMlbKey(k)));
module.exports = { mlbOn, isMlbKey, withoutMlb };
