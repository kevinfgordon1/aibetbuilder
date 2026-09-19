import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KENNETH_GUIDO_EMAIL,
  KENNETH_ODDS_BOARD_ALERT_ID,
  normalizeEmail,
  emailsMatch,
  userEmail,
  isKennethGuido,
  kennethOddsBoardAnnouncement,
  shouldShowKennethOddsBoardAlert,
} from "./targetedAlerts.js";
import {
  canSeeNewOddsBoard,
  canSeeOwnerTools,
  canSeeUnderdogPredict,
  parseAppHash,
  resolveAppHash,
  tabHash,
} from "./comboAccess.js";

const kenneth = {
  id: "uid-kenneth",
  email: "kmguido97@gmail.com",
  user_metadata: { full_name: "Kenneth Guido" },
};
const kennethCased = { id: "uid-kenneth-case", email: "KMGuido97@Gmail.com" };
const kevin = { id: "uid-kevin", email: "kev120909@gmail.com" };
const stranger = { id: "uid-stranger", email: "stranger@gmail.com" };

assert.equal(KENNETH_GUIDO_EMAIL, "kmguido97@gmail.com");
assert.equal(KENNETH_ODDS_BOARD_ALERT_ID, "kenneth-new-odds-board");
assert.equal(normalizeEmail("  KMGuido97@Gmail.COM "), "kmguido97@gmail.com");
assert.equal(emailsMatch("KMGuido97@Gmail.com", KENNETH_GUIDO_EMAIL), true);
assert.equal(emailsMatch("stranger@gmail.com", KENNETH_GUIDO_EMAIL), false);
assert.equal(emailsMatch("", ""), false);
assert.equal(userEmail(kenneth), "kmguido97@gmail.com");
assert.equal(userEmail({ user_metadata: { email: "KMGuido97@Gmail.com" } }), "kmguido97@gmail.com");
assert.equal(isKennethGuido(kenneth), true);
assert.equal(isKennethGuido(kennethCased), true);
assert.equal(isKennethGuido(kevin), false);
assert.equal(isKennethGuido(stranger), false);
assert.equal(isKennethGuido(null), false);

{
  const ann = kennethOddsBoardAnnouncement();
  assert.equal(ann.id, KENNETH_ODDS_BOARD_ALERT_ID);
  assert.equal(ann.title, "New Odds Board");
  assert.match(ann.body, /Kevin shared the live New Odds Board/i);
  assert.match(ann.body, /live odds and moneylines across the books/i);
  assert.match(ann.body, /including Underdog Predict/i);
  assert.match(ann.body, /best odds highlighted/i);
  assert.match(ann.body, /Open it anytime from the top nav/i);
  assert.equal(ann.enabled, true);
  assert.deepEqual(ann.cta, {
    label: "Open New Odds Board",
    href: tabHash("oddsBetstamp"),
  });
  assert.equal(ann.cta.href, "#new-odds-board");
}

assert.equal(shouldShowKennethOddsBoardAlert(kenneth, {}), true);
assert.equal(shouldShowKennethOddsBoardAlert(kenneth, { seenTargetedAlertId: "" }), true);
assert.equal(shouldShowKennethOddsBoardAlert(kennethCased, { seenAnnouncementId: "global-blast" }), true);
assert.equal(shouldShowKennethOddsBoardAlert(kenneth, { seenTargetedAlertId: KENNETH_ODDS_BOARD_ALERT_ID }), false);
assert.equal(shouldShowKennethOddsBoardAlert(kenneth, {}, { sessionDismissed: true }), false);
assert.equal(shouldShowKennethOddsBoardAlert(kevin, {}), false);
assert.equal(shouldShowKennethOddsBoardAlert(stranger, {}), false);
assert.equal(shouldShowKennethOddsBoardAlert(null, {}), false);
assert.equal(shouldShowKennethOddsBoardAlert({ email: "other@gmail.com" }, { seenTargetedAlertId: "" }), false);

assert.equal(canSeeNewOddsBoard(kenneth), true);
assert.equal(canSeeNewOddsBoard(kennethCased), true);
assert.equal(canSeeNewOddsBoard(kevin), true);
assert.equal(canSeeNewOddsBoard(stranger), false);
assert.equal(canSeeNewOddsBoard(null), false);
assert.equal(canSeeOwnerTools(kenneth), false);
assert.equal(canSeeUnderdogPredict(kenneth), true);
assert.equal(canSeeUnderdogPredict(kennethCased), true);
{
  const allowed = resolveAppHash(parseAppHash("#new-odds-board"), kenneth);
  assert.equal(allowed.tab, "oddsBetstamp");
  assert.equal(allowed.allowed, true);
  const cased = resolveAppHash(parseAppHash(tabHash("oddsBetstamp")), kennethCased);
  assert.equal(cased.tab, "oddsBetstamp");
  assert.equal(cased.allowed, true);
  const denied = resolveAppHash(parseAppHash("#new-odds-board"), stranger);
  assert.equal(denied.tab, "promo");
  assert.equal(denied.allowed, false);
  const miss = resolveAppHash(parseAppHash("#missTape"), kenneth);
  assert.equal(miss.tab, "promo");
  assert.equal(miss.notice, "noaccess");
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const whatsNew = fs.readFileSync(path.join(dir, "whatsNew.js"), "utf8");
  const modal = fs.readFileSync(path.join(dir, "WhatsNewModal.jsx"), "utf8");
  const profile = fs.readFileSync(path.join(dir, "userProfile.js"), "utf8");
  const access = fs.readFileSync(path.join(dir, "comboAccess.js"), "utf8");

  assert.match(app, /shouldShowKennethOddsBoardAlert\(user, profilePrefs/);
  assert.match(app, /kennethOddsBoardAnnouncement\(\)/);
  assert.match(app, /seenTargetedAlertId: KENNETH_ODDS_BOARD_ALERT_ID/);
  assert.match(app, /setTargetedAlertSessionDismissed\(true\)/);
  assert.match(app, /persistProfilePrefsRemote/);
  assert.match(app, /canSeeNewOddsBoard\(user\)/);
  assert.match(app, /activeTab === "oddsBetstamp" && canSeeNewOddsBoard\(user\)/);
  assert.match(app, /href=\{tabHash\("oddsBetstamp"\)\}/);
  assert.doesNotMatch(app, /activeTab === "oddsBetstamp" && canSeeOwnerTools\(user\)/);
  assert.match(app, /shouldShowWhatsNew\(whatsNew, profilePrefs\)/);
  assert.match(app, /!shouldShowKennethOddsBoardAlert\(user, profilePrefs\)/);

  assert.doesNotMatch(whatsNew, /kmguido97@gmail.com/);
  assert.doesNotMatch(whatsNew, /kenneth-new-odds-board/);
  assert.doesNotMatch(whatsNew, /Kevin shared the live odds board/);
  assert.doesNotMatch(whatsNew, /export const ANNOUNCEMENT/);

  assert.match(modal, /onClick=\{close\}/);
  assert.match(profile, /seenTargetedAlertId/);
  assert.match(access, /KENNETH_GUIDO_EMAIL/);
  assert.match(access, /canSeeNewOddsBoard/);
  assert.match(access, /KENNETH_GUIDO_EMAIL\.toLowerCase\(\)/);
  const envEx = fs.readFileSync(path.join(dir, "..", ".env.example"), "utf8");
  assert.match(envEx, /kmguido97@gmail.com/);
  assert.match(envEx, /VITE_UNDERDOG_PREDICT_ALLOWLIST=kev120909@gmail.com,kmguido97@gmail.com/);
}

console.log("targetedAlerts.test.js ok");
