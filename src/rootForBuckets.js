// Safety net for a moneyline outcome ("DET") whose game's chances are split into spread buckets
// ("DET>=4", "DET<4"): the plain team is the sum of its buckets. Unknown outcomes are left as-is.
// "DET>=4", "DET<4", and a finer band "DET<3>=2" (margin 2, used when the bet line and the Kalshi line differ).
const BUCKET = (o) => new RegExp(`^${String(o).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:>=\\d+|<\\d+(?:>=\\d+)?)$`);
export function expandAllowed(allowed = [], dist) {
  if (!dist) return allowed;
  const out = [];
  for (const o of allowed) {
    if (o in dist) { out.push(o); continue; }
    const re = BUCKET(o); const parts = Object.keys(dist).filter((k) => re.test(k));
    if (parts.length) out.push(...parts); else out.push(o);
  }
  return [...new Set(out)];
}
