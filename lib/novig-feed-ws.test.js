// Novig websocket mirror: delta adds use orderId/outcomeId on the wire, and a
// refused upgrade (429) reconnects once after Retry-After.
const assert = require('assert');
const crypto = require('crypto');
const { applyBookDeltas, bookFromSnapshot, novigKey, startNovigWs } = require('./novig-feed');

{
  const book = bookFromSnapshot({ seq: 1, orders: { a: [{ orderId: 'o1', price: '0.40', qty: 10 }] } });
  applyBookDeltas(book, [
    { kind: 'add', orderId: 'o2', outcomeId: 'b', price: '0.55', qty: 5 },
    { kind: 'add', orderId: 'o3', price: '0.99', qty: 5 },
  ]);
  assert.strictEqual(book.orders.get('o2').outcome, 'b', 'outcomeId is read');
  assert.ok(!book.orders.has('o3'), 'add with no outcome is skipped');
}

const pem = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const made = [];
class RefusedWs {
  constructor() { this.handlers = {}; this.readyState = 0; made.push(this); }
  on(name, fn) { this.handlers[name] = fn; }
  send() {}
  close() { this.readyState = 3; }
}
const status = {};
const conn = startNovigWs({
  key: novigKey({ NOVIG_KEY_ID: 'kid', NOVIG_PRIVATE_KEY: pem }), base: 'https://api.novig.com', WebSocket: RefusedWs,
  status, log: () => {}, desired: () => [], onBook: () => {}, onOwned: () => {}, onLifecycle: () => {},
});
let destroyed = false;
made[0].handlers['unexpected-response']({ destroy() { destroyed = true; } }, { statusCode: 429, headers: { 'retry-after': '1' }, resume() {} });
if (made[0].handlers.close) made[0].handlers.close(1006, '');
assert.strictEqual(status.ws, 'error:http_429');
assert.ok(destroyed);
setTimeout(() => {
  assert.strictEqual(made.length, 2, 'exactly one reconnect');
  conn.stop();
  console.log('novig-feed-ws.test.js ok');
}, 2300);
