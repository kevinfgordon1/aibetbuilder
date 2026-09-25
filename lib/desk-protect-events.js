// Maps a Protect sweep onto the event list Combo Locks already polls.
// The desk ping is American odds. An event is returned only when that ping
// did not send, so the poller can alert once and does not double-ping.
'use strict';

const FIRED = new Set(['rereset', 'cancelled', 'pending']);

function centsNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v == null || v === '') return undefined;
  const n = Number(String(v).replace(/¢/g, '').trim());
  return Number.isFinite(n) ? n : undefined;
}

function eventId(action) {
  return [
    'adverse',
    action.orderId || '',
    action.newOrderId || '',
    action.oldCents != null ? action.oldCents : '',
    action.newCents != null ? action.newCents : '',
  ].join(':').slice(0, 200);
}

function labelFor(action) {
  const name = String(action.outcomeName || action.title || action.marketSlug || 'Desk rest');
  const from = action.oldAmerican ? String(action.oldAmerican) : '';
  const to = action.newAmerican ? String(action.newAmerican) : '';
  if (from && to) return `${name} ${from} → ${to}`;
  if (from) return `${name} ${from}`;
  return name;
}

function watcherEventsFromActions(actions, ackedIds) {
  const acked = new Set(Array.isArray(ackedIds) ? ackedIds.map((id) => String(id)) : []);
  const events = [];
  for (const action of actions || []) {
    if (!action || !FIRED.has(action.result)) continue;
    if (action.telegram === true) continue;
    const id = eventId(action);
    if (!id || acked.has(id)) continue;
    const fromCents = centsNumber(action.oldCents);
    const toCents = centsNumber(action.newCents);
    const ev = {
      id,
      kind: 'adverse-reprice',
      adverse: true,
      chase: false,
      orderId: action.orderId || '',
      newOrderId: action.newOrderId || '',
      marketSlug: action.marketSlug || '',
      label: labelFor(action),
      action: action.action || '',
      outcomeName: action.outcomeName || '',
      oldAmerican: action.oldAmerican || '',
      newAmerican: action.newAmerican || '',
    };
    if (fromCents != null) ev.fromCents = fromCents;
    if (toCents != null) ev.toCents = toCents;
    events.push(ev);
  }
  return events;
}

module.exports = {
  watcherEventsFromActions,
};
