// Detect a newer deployed bundle while a tab stays open. index.html is already
// served "max-age=0, must-revalidate", so a reload always gets the new build —
// but a tab left open for hours keeps running the old JS (Oct 19 2026: Kevin's
// Combo Locks tab still lacked NBA two hours after it shipped).
export function entryScriptFromHtml(html) {
  const m = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(String(html || ""));
  return m ? m[0] : null;
}
export function currentEntryScript(doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return null;
  for (const s of doc.querySelectorAll("script[src]")) {
    const m = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(s.getAttribute("src") || "");
    if (m) return m[0];
  }
  return null;
}
export function isNewer(current, latest) {
  return Boolean(current && latest && current !== latest);
}
