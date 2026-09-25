'use strict';

const assert = require('node:assert/strict');
const { watcherEventsFromActions } = require('./desk-protect-events');

const fired = {
  result: 'rereset',
  orderId: 'ord-1',
  newOrderId: 'ord-2',
  marketSlug: 'aec-nfl-lac-ten-2025-11-02',
  title: 'Los Angeles vs. Tennessee',
  action: 'buy',
  outcomeName: 'Los Angeles Chargers',
  oldAmerican: '-150',
  newAmerican: '-122',
  oldCents: '60¢',
  newCents: '55¢',
  telegram: false,
};

{
  const [ev] = watcherEventsFromActions([fired]);
  assert.equal(ev.kind, 'adverse-reprice');
  assert.equal(ev.adverse, true);
  assert.equal(ev.chase, false);
  assert.equal(ev.fromCents, 60);
  assert.equal(ev.toCents, 55);
  assert.match(ev.label, /Chargers/);
  assert.match(ev.label, /-150/);
  assert.match(ev.label, /-122/);
  assert.equal(ev.id, 'adverse:ord-1:ord-2:60¢:55¢');
}

{
  assert.deepEqual(watcherEventsFromActions([{ ...fired, telegram: true }]), []);
  assert.deepEqual(watcherEventsFromActions([fired], [fired && 'adverse:ord-1:ord-2:60¢:55¢']), []);
  assert.deepEqual(watcherEventsFromActions([
    { result: 'parked', orderId: 'ord-1' },
    { result: 'gone', orderId: 'ord-2' },
    { result: 'error', orderId: 'ord-3' },
  ]), []);
}

console.log('desk-protect-events.test.js ok');
