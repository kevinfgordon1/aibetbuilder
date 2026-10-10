'use strict';
const assert = require('assert');
const { parseComboLinkToken, linkComboChat } = require('./combo-tg-link');

assert.strictEqual(parseComboLinkToken('/start cl_abcdefghijklmnop1234'), 'abcdefghijklmnop1234');
assert.strictEqual(parseComboLinkToken('/start@Kaygosports_bot cl_abcdefghijklmnop1234'), 'abcdefghijklmnop1234');
assert.strictEqual(parseComboLinkToken('/start'), null);
assert.strictEqual(parseComboLinkToken('/start cl_short'), null);
assert.strictEqual(parseComboLinkToken('/start abcdefghijklmnop1234'), null);
assert.strictEqual(parseComboLinkToken('hi cl_abcdefghijklmnop1234'), null);

function db(rows) {
  return { from() { const st = {}; const q = {
    update(v) { st.v = v; return q; }, eq(c, x) { st.c = c; st.x = x; return q; }, select() { return q; },
    then(res) { const hit = rows.filter((r) => r[st.c] === st.x); hit.forEach((r) => Object.assign(r, st.v)); return Promise.resolve({ data: hit.map((r) => ({ user_id: r.user_id })), error: null }).then(res); },
  }; return q; } };
}
(async () => {
  const rows = [{ user_id: 'kenny', link_token: 'tok1234567890abcdef', chat_id: null, enabled: false }, { user_id: 'other', link_token: 'zzz', chat_id: null }];
  const ok = await linkComboChat(db(rows), 'tok1234567890abcdef', 42);
  assert.strictEqual(ok.linked, true);
  assert.strictEqual(rows[0].chat_id, 42);
  assert.strictEqual(rows[0].enabled, true);
  assert.strictEqual(rows[1].chat_id, null);
  const bad = await linkComboChat(db(rows), 'nope', 43);
  assert.strictEqual(bad.linked, false);
  console.log('combo-tg-link tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
