'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const { verifyVectors, locationErrorText, readNovigDeskCreds, stringToSign, signString, loadPrivateKey } = require('./novig-auth');
const vectors = require('./novig-signing-vectors.json');

{
  const r = verifyVectors(vectors);
  assert.equal(r.ok, true, JSON.stringify(r.failures.slice(0, 3)));
  assert.equal(r.total, 30);
}

{
  assert.match(locationErrorText('GEOLOCATION_EXPIRED'), /Open the Novig app/);
  assert.match(locationErrorText('ANONYMIZED_NETWORK'), /VPN/);
}

{
  const pem = vectors.keypairs['ed25519-test-1'].private_key_pkcs8_pem;
  const creds = readNovigDeskCreds({
    NOVIG_DESK_KEY_ID: '00000000-0000-4000-8000-000000000001',
    NOVIG_DESK_PRIVATE_KEY: pem,
    NOVIG_API_BASE: 'https://api.paper.novig.com',
  });
  assert.equal(creds.ok, true);
  assert.equal(creds.isPaper, true);
  const key = loadPrivateKey(pem);
  const text = stringToSign({ timestamp: 1, method: 'POST', path: '/v3/echo', query: '', body: '{"a":1}' });
  assert.match(text, /^NOVIG-V3\n/);
  assert.ok(signString(key, text).length > 20);
}

console.log('novig-auth.test.js ok');
