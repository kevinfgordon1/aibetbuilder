// New Odds Board drag order. Hide / book-visibility toggles stay session-only;
// custom row + column order persists per signed-in user in localStorage so a
// refresh or live tick does not reset Kevin's slate.

import { identityFromUser } from "./userProfile.js";

export const ODDS_BOARD_ORDER_STORAGE_PREFIX = "aibetbuilder.newOddsBoard.order";

export function oddsBoardOrderStorageKey(user) {
  const ident = identityFromUser(user);
  const token = String(ident.id || ident.email || "anon").trim().toLowerCase();
  return `${ODDS_BOARD_ORDER_STORAGE_PREFIX}.${token || "anon"}`;
}

export function oddsBoardSlateKey(sport, liveOnly) {
  return `${String(sport || "slate")}:${liveOnly ? "live" : "pregame"}`;
}

export function emptyOddsBoardOrder() {
  return { bookKeys: [], gamesBySlate: {} };
}

export function sanitizeKeyList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const key = String(item == null ? "" : item).trim();
    if (!key || key === "best" || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function normalizeOddsBoardOrder(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const gamesBySlate = {};
  const slates = src.gamesBySlate && typeof src.gamesBySlate === "object" ? src.gamesBySlate : {};
  for (const [slate, ids] of Object.entries(slates)) {
    if (!slate) continue;
    const list = sanitizeKeyList(ids);
    if (list.length) gamesBySlate[slate] = list;
  }
  return {
    bookKeys: sanitizeKeyList(src.bookKeys),
    gamesBySlate,
  };
}

export function loadOddsBoardOrder(user, storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    const raw = store && store.getItem(oddsBoardOrderStorageKey(user));
    if (!raw) return emptyOddsBoardOrder();
    return normalizeOddsBoardOrder(JSON.parse(raw));
  } catch {
    return emptyOddsBoardOrder();
  }
}

export function saveOddsBoardOrder(user, order, storage) {
  const next = normalizeOddsBoardOrder(order);
  try {
    const store = storage ?? globalThis.localStorage;
    if (store) store.setItem(oddsBoardOrderStorageKey(user), JSON.stringify(next));
  } catch {
    // quota / privacy mode
  }
  return next;
}

/** Saved keys first (their relative order), then any new keys in incoming order. */
export function applyKeyOrder(keys, savedKeys) {
  const list = sanitizeKeyList(keys);
  const saved = sanitizeKeyList(savedKeys);
  if (!saved.length) return list;
  const rank = new Map(saved.map((key, i) => [key, i]));
  const known = [];
  const unknown = [];
  for (const key of list) {
    if (rank.has(key)) known.push(key);
    else unknown.push(key);
  }
  known.sort((a, b) => rank.get(a) - rank.get(b));
  return [...known, ...unknown];
}

export function applyGameRowOrder(games, savedIds) {
  if (!Array.isArray(games) || !games.length) return [];
  const byId = new Map(games.map((g) => [String(g?.id ?? ""), g]));
  return applyKeyOrder(games.map((g) => g?.id), savedIds)
    .map((id) => byId.get(id))
    .filter(Boolean);
}

export function applyBookColumnOrder(books, savedKeys) {
  if (!Array.isArray(books) || !books.length) return [];
  const byKey = new Map(books.map((b) => [b?.key, b]));
  return applyKeyOrder(books.map((b) => b?.key), savedKeys)
    .map((key) => byKey.get(key))
    .filter(Boolean);
}

export function reorderKeys(keys, fromIndex, toIndex) {
  const list = sanitizeKeyList(keys);
  if (fromIndex === toIndex) return list;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function moveKeyAmongVisible(visibleIds, fromId, toId, savedIds) {
  const from = String(fromId ?? "").trim();
  const to = String(toId ?? "").trim();
  const visible = applyKeyOrder(visibleIds, savedIds);
  const saved = sanitizeKeyList(savedIds);
  const merge = (front) => {
    const seen = new Set(front);
    return [...front, ...saved.filter((id) => !seen.has(id))];
  };
  if (!from || !to || from === to) return merge(visible);
  const fromIndex = visible.indexOf(from);
  const toIndex = visible.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return merge(visible);
  return merge(reorderKeys(visible, fromIndex, toIndex));
}

/** Walk a custom-ordered slate and keep date headers only when the date changes. */
export function groupGamesPreservingOrder(games, dateFor) {
  const blocks = [];
  if (!Array.isArray(games)) return blocks;
  const label = typeof dateFor === "function" ? dateFor : (g) => String(g?.dateKey || "");
  for (const game of games) {
    const dateKey = label(game);
    const last = blocks[blocks.length - 1];
    if (!last || last.dateKey !== dateKey) blocks.push({ dateKey, games: [game] });
    else last.games.push(game);
  }
  return blocks;
}

export function moveKeyByOffset(visibleIds, key, delta, savedIds) {
  const visible = applyKeyOrder(visibleIds, savedIds);
  const from = String(key ?? "").trim();
  const i = visible.indexOf(from);
  if (i < 0 || !delta) {
    const seen = new Set(visible);
    const rest = sanitizeKeyList(savedIds).filter((id) => !seen.has(id));
    return [...visible, ...rest];
  }
  const j = Math.max(0, Math.min(visible.length - 1, i + Number(delta)));
  return moveKeyAmongVisible(visible, from, visible[j], savedIds);
}
