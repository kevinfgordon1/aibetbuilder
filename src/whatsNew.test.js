import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WHATS_NEW_TABLE,
  sanitizeCtaHref,
  newAnnouncementId,
  normalizeAnnouncement,
  isPublishedAnnouncement,
  shouldShowWhatsNew,
  announcementRowFromDraft,
  fetchActiveAnnouncement,
  fetchLatestAnnouncement,
  publishAnnouncement,
  unpublishAnnouncement,
} from "./whatsNew.js";

const sample = {
  id: "2026-09-05T12:00:00.000Z-abc",
  title: "Locks update",
  body: "New P/L filters.\nAlso combo colors.",
  enabled: true,
};

assert.equal(WHATS_NEW_TABLE, "whats_new_announcements");

assert.equal(sanitizeCtaHref("#profile"), "#profile");
assert.equal(sanitizeCtaHref("/promo"), "/promo");
assert.equal(sanitizeCtaHref("https://aibetbuilder.io"), "https://aibetbuilder.io");
assert.equal(sanitizeCtaHref("javascript:alert(1)"), "");
assert.equal(sanitizeCtaHref("data:text/html,x"), "");

{
  const id = newAnnouncementId(new Date("2026-09-05T12:00:00.000Z"));
  assert.match(id, /^2026-09-05T12:00:00\.000Z-/);
}

{
  const n = normalizeAnnouncement({
    id: " a ",
    title: " Title ",
    body: " Body ",
    cta_label: "Open",
    cta_href: "#profile",
    enabled: true,
    published_at: "2026-09-05T12:00:00.000Z",
  });
  assert.equal(n.id, "a");
  assert.equal(n.title, "Title");
  assert.equal(n.body, "Body");
  assert.deepEqual(n.cta, { label: "Open", href: "#profile" });
  assert.equal(n.enabled, true);
}

assert.equal(normalizeAnnouncement({ title: "x", body: "y" }), null);
assert.equal(isPublishedAnnouncement(null), false);
assert.equal(isPublishedAnnouncement({ id: "x", title: "", body: "b", enabled: true }), false);
assert.equal(isPublishedAnnouncement({ id: "x", title: "t", body: "b", enabled: false }), false);
assert.equal(isPublishedAnnouncement(sample), true);

assert.equal(shouldShowWhatsNew(null, {}), false);
assert.equal(shouldShowWhatsNew({ id: "" }, {}), false);
assert.equal(shouldShowWhatsNew({ id: "x", title: "t", body: "b", enabled: false }, {}), false);
assert.equal(shouldShowWhatsNew(sample, { seenAnnouncementId: "" }), true);
assert.equal(shouldShowWhatsNew(sample, {}), true);
assert.equal(shouldShowWhatsNew(sample, { seenAnnouncementId: sample.id }), false);
assert.equal(shouldShowWhatsNew({ ...sample, id: sample.id + "-next" }, { seenAnnouncementId: sample.id }), true);
assert.equal(shouldShowWhatsNew(sample, { seenAnnouncementId: "" }, { sessionDismissed: true }), false);

{
  const row = announcementRowFromDraft(
    { title: " Hi ", body: " There ", ctaLabel: "Profile", ctaHref: "#profile" },
    { now: "2026-09-05T12:00:00.000Z", id: "ann-1" },
  );
  assert.deepEqual(row, {
    id: "ann-1",
    title: "Hi",
    body: "There",
    cta_label: "Profile",
    cta_href: "#profile",
    enabled: true,
    published_at: "2026-09-05T12:00:00.000Z",
  });
}

function mockClient({ rows = [], updateError = null, insertError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const builder = {
        _select: null,
        _filters: [],
        select(cols) {
          builder._select = cols;
          return builder;
        },
        eq(col, val) {
          builder._filters.push([col, val]);
          return builder;
        },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle: async () => {
          calls.push({ op: "select", table, filters: builder._filters.slice() });
          let list = rows.slice();
          for (const [col, val] of builder._filters) {
            list = list.filter((r) => r[col] === val);
          }
          return { data: list[0] || null, error: null };
        },
        update(payload) {
          return {
            eq: async (col, val) => {
              calls.push({ op: "update", table, payload, col, val });
              return { error: updateError };
            },
          };
        },
        insert(row) {
          return {
            select() {
              return {
                single: async () => {
                  calls.push({ op: "insert", table, row });
                  if (insertError) return { data: null, error: insertError };
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
      return builder;
    },
  };
}

{
  const client = mockClient({
    rows: [{ id: "live-1", title: "Hello", body: "World", enabled: true }],
  });
  const ann = await fetchActiveAnnouncement(client);
  assert.equal(ann.id, "live-1");
  assert.equal(ann.title, "Hello");
  assert.equal(client.calls[0].filters.some(([c, v]) => c === "enabled" && v === true), true);
}

{
  const client = mockClient({ rows: [] });
  assert.equal(await fetchActiveAnnouncement(client), null);
}

{
  const client = mockClient({
    rows: [{ id: "old", title: "Old", body: "Copy", enabled: false }],
  });
  assert.equal(await fetchActiveAnnouncement(client), null);
  const latest = await fetchLatestAnnouncement(client);
  assert.equal(latest.id, "old");
  assert.equal(latest.enabled, false);
}

{
  const client = mockClient();
  const result = await publishAnnouncement(client, { title: "New", body: "Copy" }, {
    now: "2026-09-05T15:00:00.000Z",
    id: "ann-2",
  });
  assert.equal(result.ok, true);
  assert.equal(result.announcement.id, "ann-2");
  assert.equal(result.announcement.title, "New");
  assert.equal(client.calls[0].op, "update");
  assert.deepEqual(client.calls[0].payload, { enabled: false });
  assert.equal(client.calls[0].col, "enabled");
  assert.equal(client.calls[0].val, true);
  assert.equal(client.calls[1].op, "insert");
  assert.equal(client.calls[1].row.id, "ann-2");
  assert.equal(client.calls[1].row.enabled, true);
}

{
  const missing = await publishAnnouncement(mockClient(), { title: "", body: "x" });
  assert.equal(missing.ok, false);
}

{
  const client = mockClient();
  const result = await unpublishAnnouncement(client);
  assert.equal(result.ok, true);
  assert.equal(client.calls[0].op, "update");
  assert.deepEqual(client.calls[0].payload, { enabled: false });
}

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const constant = fs.readFileSync(path.join(dir, "whatsNew.js"), "utf8");
  const modal = fs.readFileSync(path.join(dir, "WhatsNewModal.jsx"), "utf8");
  const composer = fs.readFileSync(path.join(dir, "WhatsNewComposer.jsx"), "utf8");
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const profile = fs.readFileSync(path.join(dir, "UserProfile.jsx"), "utf8");
  const sql = fs.readFileSync(path.join(dir, "..", "sql", "whats_new_announcements.sql"), "utf8");

  assert.doesNotMatch(constant, /export const ANNOUNCEMENT/);
  assert.doesNotMatch(constant, /2026-09-05-profile-combo-promo/);
  assert.doesNotMatch(constant, /Profile P\/L statements now have dates/);
  assert.match(constant, /whats_new_announcements/);

  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /Got it/);
  assert.match(modal, /Escape/);
  assert.match(modal, /aria-label="Close"/);

  assert.match(composer, /id="wn-title"/);
  assert.match(composer, /id="wn-body"/);
  assert.match(composer, /Publish/);
  assert.match(composer, /Unpublish/);
  assert.match(composer, /Preview/);
  assert.match(composer, /publishAnnouncement/);
  assert.match(composer, /unpublishAnnouncement/);

  assert.match(app, /<WhatsNewModal/);
  assert.match(app, /fetchActiveAnnouncement\(supabase\)/);
  assert.match(app, /shouldShowWhatsNew\(whatsNew, profilePrefs\)/);
  assert.match(app, /user && profilePrefsReady && whatsNewReady/);
  assert.match(app, /setWhatsNewSessionDismissed\(true\)/);
  assert.match(app, /persistProfilePrefsRemote/);
  assert.match(app, /seenAnnouncementId: whatsNew\.id/);
  assert.match(app, /onAnnouncementPublished/);
  assert.match(app, /onAnnouncementUnpublished/);
  assert.doesNotMatch(app, /shouldShowWhatsNew\(ANNOUNCEMENT/);
  assert.doesNotMatch(app, /seenAnnouncementId: ANNOUNCEMENT\.id/);

  assert.match(profile, /WhatsNewComposer/);
  assert.match(profile, /canSeeOwnerTools\(user\)/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.whats_new_announcements/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /kev120909@gmail.com/);
  assert.match(sql, /enabled = true/);
  assert.match(sql, /whats_new_announcements_active_published_at_idx/);
}

console.log("whatsNew.test.js ok");
