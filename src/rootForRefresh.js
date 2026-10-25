// What to root for needle: client auto-refresh cadence (the server cron in vercel.json runs */5 too).
// Sunday Oct 18, 2026 only: 2-minute refresh. Since Oct 25, 2026 (Kevin): 5 min, matching the */5 needle cron.
const FAST_UNTIL = Date.parse("2026-10-19T04:00:00Z");
export const refreshMs = (now = Date.now()) => (now < FAST_UNTIL ? 2 : 5) * 60 * 1000;
