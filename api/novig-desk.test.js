'use strict';

const assert = require('node:assert/strict');
const desk = require('./novig-desk');

function mockRes() {
  const out = { statusCode: 0, body: null, headers: {}, ended: false };
  return {
    out,
    headersSent: false,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; this.headersSent = true; return this; },
    json(body) { out.body = body; out.ended = true; return this; },
    end() { out.ended = true; return this; },
  };
}

function bodyText(res) {
  return JSON.stringify(res.out.body || {});
}

(async () => {
  desk._resetHttpDeps();
  assert.equal(typeof desk, 'function');
  assert.equal(typeof desk.handle, 'function');
  assert.equal(typeof desk.snapshot, 'function');

  {
    const res = mockRes();
    await desk({ method: 'GET', headers: {} }, res);
    assert.equal(res.out.statusCode, 401);
    assert.equal(res.out.body.ok, false);
    assert.equal(res.out.body.error, 'Sign in required');
    assert.equal(res.out.body.stack, undefined);
    assert.doesNotMatch(bodyText(res), /at\s+\S+\s+\(/);
    assert.equal(res.out.headers['Cache-Control'], 'no-store');
  }

  {
    const res = mockRes();
    await desk({ method: 'POST', headers: {}, body: { op: 'place' } }, res);
    assert.equal(res.out.statusCode, 401);
    assert.equal(res.out.body.error, 'Sign in required');
    assert.doesNotMatch(bodyText(res), /stack/i);
  }

  {
    const res = mockRes();
    await desk({ method: 'PUT', headers: { authorization: 'Bearer tok' } }, res);
    assert.equal(res.out.statusCode, 405);
    assert.equal(res.out.body.error, 'Method not allowed');
  }

  {
    const res = mockRes();
    await desk({ method: 'OPTIONS', headers: {} }, res);
    assert.equal(res.out.statusCode, 204);
  }

  desk._setHttpDeps({
    requireUser: async () => {
      const err = new Error('boom SECRET_STACK');
      err.stack = 'Error: boom SECRET_STACK\n    at hidden (api/novig-desk.js:1:1)';
      throw err;
    },
  });
  {
    const res = mockRes();
    await desk({ method: 'GET', headers: { authorization: 'Bearer tok' } }, res);
    assert.equal(res.out.statusCode, 401);
    assert.equal(res.out.body.error, 'Sign in required');
    assert.equal(Object.prototype.hasOwnProperty.call(res.out.body, 'stack'), false);
    assert.doesNotMatch(bodyText(res), /SECRET_STACK/);
    assert.doesNotMatch(bodyText(res), /novig-desk\.js/);
  }

  let fetchCalls = 0;
  desk._setHttpDeps({
    requireUser: async () => ({ ok: false, status: 403, error: 'Not allowed\n    at hidden (api/novig-desk.js:9:1)' }),
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not call Novig'); },
  });
  {
    const res = mockRes();
    await desk({ method: 'GET', headers: { authorization: 'Bearer tok' }, query: { venue: 'novig' } }, res);
    assert.equal(res.out.statusCode, 403);
    assert.equal(res.out.body.error, 'Not allowed');
    assert.equal(fetchCalls, 0);
    assert.doesNotMatch(bodyText(res), /hidden/);
  }

  desk._setHttpDeps({
    requireUser: async () => ({ ok: true, user: { email: 'owner@example.com' } }),
    novigCreds: () => ({ ok: false, missing: ['NOVIG_KEY_ID'] }),
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not call Novig'); },
    protectStore: () => null,
  });
  {
    const res = mockRes();
    await desk({ method: 'GET', headers: { authorization: 'Bearer tok' }, query: {} }, res);
    assert.equal(res.out.statusCode, 503);
    assert.equal(res.out.body.ok, false);
    assert.match(res.out.body.error, /NOVIG_KEY_ID/);
    assert.equal(res.out.body.stack, undefined);
    assert.doesNotMatch(bodyText(res), /SECRET_STACK/);
    assert.equal(fetchCalls, 0);
  }

  desk._resetHttpDeps();
  console.log('novig-desk.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
