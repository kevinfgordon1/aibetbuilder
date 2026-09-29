import { useEffect, useSyncExternalStore } from "react";
import { gameStateLine, nflGameStateFor, nflGameStates, startNflGameStatePoll, subscribeNflGameState, freshnessMode } from "./nflGameState.js";

/** Poll ESPN (PM US fallback) while an NFL board with live games is on screen. */
export function useNflGameStatePoll(enabled) {
  useEffect(() => (enabled ? startNflGameStatePoll() : undefined), [enabled]);
}

/** Small "Q2 8:30 · PHI ball · 3rd & 4 at CHI 35" line under LIVE. */
export function GameStateLine({ game }) {
  useSyncExternalStore(subscribeNflGameState, nflGameStates, nflGameStates);
  if (!game?.is_live) return null;
  const st = nflGameStateFor(game);
  const text = gameStateLine(st);
  if (!text) return null;
  const m = freshnessMode(st, Date.now());
  const title = `${st.source === "espn" ? "ESPN" : "Polymarket US"} game state` + (m.mode !== "running" ? ` · frozen rule ${m.mode === "pulled" ? "paused" : "loosened"} (${m.reason})` : "");
  return (
    <div
      data-game-state={m.mode}
      title={title}
      style={{ fontSize: 10, color: m.mode === "running" ? "var(--nob-faint)" : "var(--nob-warn, #d9a441)", lineHeight: 1.15, margin: "0 0 1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
    >
      {text}
    </div>
  );
}
