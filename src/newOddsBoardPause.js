// Single switch for the New Odds Board tab (Politics, NFL, and every other
// sport on that board).
//
// true  — the tab stays in the nav and shows "New Odds Board is paused."
//         BetstampOddsBoard is not mounted, so it does not poll, fetch, or
//         open SSE/WebSocket connections, and it does not call board API
//         routes (Polymarket US, Kalshi, ProphetX, Robinhood, the odds
//         relay, or anything else that board starts).
// false — mount BetstampOddsBoard again. That is the whole re-enable.
export const NEW_ODDS_BOARD_PAUSED = true;
