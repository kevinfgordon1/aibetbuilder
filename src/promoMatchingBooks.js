// Promo Builder "Matching books" Extra Filter.
// Persist the unchecked trusted-book set. Empty/invalid storage = all on.
// EV alerts / lib/promo-ev.js keep the full TRUSTED_BOOK_KEYS set.

export const MATCHING_BOOKS_STORAGE_KEY = "aibetbuilder.promoMatchingBooksExcluded";

export function matchingBookList(allBooks, trustedKeys) {
  return allBooks.filter((b) => trustedKeys.has(b.key));
}

export function matchingSetIsFull(matchingKeys, trustedKeys) {
  if (!matchingKeys || matchingKeys.size !== trustedKeys.size) return false;
  for (const key of trustedKeys) {
    if (!matchingKeys.has(key)) return false;
  }
  return true;
}

export function parseExcludedMatchingBooks(raw, trustedKeys) {
  if (raw == null || raw === "") return new Set();
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const excluded = new Set();
  for (const key of parsed) {
    if (typeof key === "string" && trustedKeys.has(key)) excluded.add(key);
  }
  // Unchecking every trusted book is invalid — treat as all on.
  if (excluded.size >= trustedKeys.size) return new Set();
  return excluded;
}

export function loadExcludedMatchingBooks(trustedKeys, storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    if (!store) return new Set();
    return parseExcludedMatchingBooks(store.getItem(MATCHING_BOOKS_STORAGE_KEY), trustedKeys);
  } catch {
    return new Set();
  }
}

export function matchingKeysFromExcluded(excluded, trustedKeys) {
  const matching = new Set(trustedKeys);
  if (excluded) {
    for (const key of excluded) matching.delete(key);
  }
  if (matching.size === 0) return new Set(trustedKeys);
  return matching;
}

export function excludedFromMatching(matchingKeys, trustedKeys) {
  const excluded = [];
  for (const key of trustedKeys) {
    if (!matchingKeys.has(key)) excluded.push(key);
  }
  return excluded;
}

export function saveExcludedMatchingBooks(matchingKeys, trustedKeys, storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    if (!store) return;
    store.setItem(MATCHING_BOOKS_STORAGE_KEY, JSON.stringify(excludedFromMatching(matchingKeys, trustedKeys)));
  } catch {
    // quota / privacy mode
  }
}

export function toggleMatchingBookKey(matchingKeys, key, trustedKeys) {
  if (!trustedKeys.has(key)) return matchingKeys;
  const next = new Set(matchingKeys);
  if (next.has(key)) {
    if (next.size <= 1) return matchingKeys;
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

export function loadMatchingBookKeys(trustedKeys, storage) {
  return matchingKeysFromExcluded(loadExcludedMatchingBooks(trustedKeys, storage), trustedKeys);
}
