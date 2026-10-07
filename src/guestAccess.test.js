import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GUEST_EXPLAINER_COPY,
  PUBLIC_APP_TABS,
  guestActionNeedsSignIn,
  isPublicAppTab,
  promoControlSummary,
} from "./guestAccess.js";
import { bookHasPostedPrice } from "./oddsBoard.js";

assert.match(GUEST_EXPLAINER_COPY, /Got a sportsbook boost or free bet/);
assert.match(GUEST_EXPLAINER_COPY, /Free with Google/);
assert.deepEqual(PUBLIC_APP_TABS, ["promo", "ev", "odds"]);
assert.equal(isPublicAppTab("promo"), true);
assert.equal(isPublicAppTab("ev"), true);
assert.equal(isPublicAppTab("odds"), true);
assert.equal(isPublicAppTab("liveDesk"), false);
assert.equal(isPublicAppTab("oddsBetstamp"), false);

for (const action of ["show-more", "copy-link", "share-image", "save", "combo", "profile"]) {
  assert.equal(guestActionNeedsSignIn(action), true, action);
}
assert.equal(guestActionNeedsSignIn("optimize"), false);
assert.equal(guestActionNeedsSignIn("promo-type"), false);

assert.equal(
  promoControlSummary({ bookLabel: "DraftKings", promoType: "boost", boostPct: 30, stake: 100, numLegs: 3 }),
  "DraftKings · 30% boost · $100 · 3 legs",
);
assert.equal(
  promoControlSummary({ bookLabel: "DraftKings", promoType: "nopromo", boostPct: 30, stake: 100, numLegs: 1 }),
  "DraftKings · No promo · $100 · 1 leg",
);
assert.equal(
  promoControlSummary({ bookLabel: "FanDuel", promoType: "freebet", stake: 50, numLegs: 2 }),
  "FanDuel · Free bet · $50 · 2 legs",
);

assert.equal(bookHasPostedPrice("bookmaker", { moneylines: [{ bookOdds: { draftkings: { ml_away: -110 } } }] }, []), false);
assert.equal(bookHasPostedPrice("bookmaker", { moneylines: [{ bookOdds: { bookmaker: { ml_away: -105, ml_home: -115 } } }] }, []), true);
assert.equal(bookHasPostedPrice("bookmaker", { moneylines: [] }, [{ teams: [{ books: { bookmaker: 140 } }] }]), true);
assert.equal(bookHasPostedPrice("draftkings", null, null), false);

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
const board = fs.readFileSync(path.join(dir, "OddsBoard.jsx"), "utf8");
const share = fs.readFileSync(path.join(dir, "ShareCardActions.jsx"), "utf8");

assert.match(app, /GUEST_EXPLAINER_COPY/);
assert.match(app, /data-guest-explainer/);
assert.match(app, /!authLoading && !user/);
assert.match(app, /promo-controls-summary/);
assert.match(app, /promoControlSummary\(/);
assert.match(app, /className="ev-head"/);
assert.match(app, /className="ev-row-main"/);
assert.match(app, /className="app-header"/);
assert.match(app, /signin-short/);
assert.match(app, /Sign in to see the rest of the ranked picks/);
assert.match(app, /Sign in to open your profile/);
assert.match(app, /GuestLock/);
assert.doesNotMatch(app, /onClickCapture=\{guardClick\}/);
assert.doesNotMatch(app, /onMouseDownCapture=\{guardClick\}/);
assert.doesNotMatch(app, /resolveBookmakerSnapshot/);
assert.doesNotMatch(app, /\/api\/betstamp-markets/);
assert.match(app, /canSeeNewOddsBoard\(user\)/);
assert.match(app, /canSeeOwnerTools\(user\)/);
assert.match(app, />Live Trading Desk<\/a>/);
assert.match(app, />New Odds Board<\/a>/);

assert.match(board, /odds-books-toggle/);
assert.match(board, /Books \(/);
assert.match(board, /bookHasPostedPrice/);
assert.match(share, /GuestLock/);
assert.match(share, /locked/);

console.log("guestAccess.test.js ok");
