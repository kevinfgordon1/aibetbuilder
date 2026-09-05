import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANNOUNCEMENT, shouldShowWhatsNew } from "./whatsNew.js";

assert.equal(typeof ANNOUNCEMENT.id, "string");
assert.ok(ANNOUNCEMENT.id.length > 0);
assert.ok(ANNOUNCEMENT.title);
assert.ok(ANNOUNCEMENT.body);

{
  const unseen = shouldShowWhatsNew(ANNOUNCEMENT, { seenAnnouncementId: "" });
  assert.equal(unseen, true, "show when unseen");
}

{
  const unseen = shouldShowWhatsNew(ANNOUNCEMENT, {});
  assert.equal(unseen, true, "show when prefs have no seen id");
}

{
  const hidden = shouldShowWhatsNew(ANNOUNCEMENT, { seenAnnouncementId: ANNOUNCEMENT.id });
  assert.equal(hidden, false, "hide when dismissed id matches");
}

{
  const bumped = { ...ANNOUNCEMENT, id: ANNOUNCEMENT.id + "-next" };
  const showAgain = shouldShowWhatsNew(bumped, { seenAnnouncementId: ANNOUNCEMENT.id });
  assert.equal(showAgain, true, "bumping id shows again");
}

{
  const hidden = shouldShowWhatsNew(ANNOUNCEMENT, { seenAnnouncementId: "" }, { sessionDismissed: true });
  assert.equal(hidden, false, "session dismiss hides even if persist failed");
}

assert.equal(shouldShowWhatsNew(null, {}), false);
assert.equal(shouldShowWhatsNew({ id: "" }, {}), false);

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const constant = fs.readFileSync(path.join(dir, "whatsNew.js"), "utf8");
  const modal = fs.readFileSync(path.join(dir, "WhatsNewModal.jsx"), "utf8");
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");

  assert.match(constant, /Bump ANNOUNCEMENT\.id to show again to everyone who already dismissed the previous one\./);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /Got it/);
  assert.match(modal, /Escape/);
  assert.match(modal, /aria-label="Close"/);
  assert.match(app, /<WhatsNewModal/);
  assert.match(app, /shouldShowWhatsNew\(ANNOUNCEMENT, profilePrefs\)/);
  assert.match(app, /user && profilePrefsReady/);
  assert.match(app, /setWhatsNewSessionDismissed\(true\)/);
  assert.match(app, /persistProfilePrefsRemote/);
  assert.match(app, /seenAnnouncementId: ANNOUNCEMENT\.id/);
}

console.log("whatsNew.test.js ok");
