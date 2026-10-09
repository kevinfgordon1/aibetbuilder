// Novig v3 request signing (NOVIG-V3). Ed25519 or P-256 PKCS#8 PEM.
// Headers: Novig-Key-Id, Novig-Timestamp, Novig-Signature.
// Management keys must never be loaded here — trading / trading::read only.
'use strict';

const crypto = require('crypto');
const fs = require('fs');

const EMPTY_BODY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const DEFAULT_PAPER = 'https://api.paper.novig.com';
const DEFAULT_PROD = 'https://api.novig.com';

function normalizeCred(value) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const first = s.charCodeAt(0);
  const last = s.charCodeAt(s.length - 1);
  if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function normalizePem(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (!text.includes('\n') && text.includes('\\n')) text = text.replace(/\\n/g, '\n');
  if (!text.includes('-----BEGIN')) {
    const body = text.replace(/\s+/g, '').match(/.{1,64}/g) || [];
    text = `-----BEGIN PRIVATE KEY-----\n${body.join('\n')}\n-----END PRIVATE KEY-----`;
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}

function loadPrivateKey(pem) {
  const normalized = normalizePem(pem);
  if (!normalized) return null;
  try {
    return crypto.createPrivateKey(normalized);
  } catch (_) {
    return null;
  }
}

function encodePart(s) {
  let out = '';
  for (const b of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(c)) out += c;
    else out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function decodePart(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

function canonicalQuery(raw) {
  const q = String(raw || '').replace(/^\?/, '');
  if (!q) return '';
  const pairs = q.split('&').map((pair) => {
    const i = pair.indexOf('=');
    const name = i < 0 ? pair : pair.slice(0, i);
    const value = i < 0 ? '' : pair.slice(i + 1);
    return [encodePart(decodePart(name)), encodePart(decodePart(value))];
  });
  pairs.sort((a, b) => {
    const n = Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0]));
    return n || Buffer.compare(Buffer.from(a[1]), Buffer.from(b[1]));
  });
  return pairs.map(([n, v]) => `${n}=${v}`).join('&');
}

function bodyHash(body) {
  if (body == null || body === '') return EMPTY_BODY_HASH;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (!buf.length) return EMPTY_BODY_HASH;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function stringToSign({ timestamp, method, path, query, body }) {
  return [
    'NOVIG-V3',
    String(timestamp),
    String(method || '').toUpperCase(),
    String(path || ''),
    canonicalQuery(query),
    bodyHash(body),
  ].join('\n');
}

function signString(keyObject, text) {
  const data = Buffer.from(text, 'utf8');
  if (keyObject.asymmetricKeyType === 'ed25519') {
    return crypto.sign(null, data, keyObject).toString('base64');
  }
  return crypto.sign('sha256', data, { key: keyObject, dsaEncoding: 'der' }).toString('base64');
}

function signedHeaders({ keyId, privateKey, method, path, query = '', body = '', nowMs = Date.now() }) {
  const timestamp = String(Math.floor(nowMs));
  const text = stringToSign({ timestamp, method, path, query, body });
  return {
    'Novig-Key-Id': String(keyId),
    'Novig-Timestamp': timestamp,
    'Novig-Signature': signString(privateKey, text),
  };
}

function readNovigDeskCreds(env) {
  const e = env || process.env;
  const keyId = normalizeCred(e.NOVIG_DESK_KEY_ID || e.NOVIG_KEY_ID);
  const pemRaw = e.NOVIG_DESK_PRIVATE_KEY || e.NOVIG_PRIVATE_KEY || '';
  const pem = normalizePem(pemRaw);
  const privateKey = loadPrivateKey(pem);
  const missing = [];
  if (!keyId) missing.push('NOVIG_DESK_KEY_ID');
  if (!privateKey) missing.push('NOVIG_DESK_PRIVATE_KEY');
  const host = String(e.NOVIG_API_BASE || e.NOVIG_HOST || DEFAULT_PROD).replace(/\/+$/, '');
  return {
    keyId,
    privateKey,
    pem,
    missing,
    ok: missing.length === 0,
    apiBase: host,
    isPaper: /paper\.novig\.com/i.test(host),
  };
}

function missingKeysError(missing) {
  return {
    ok: false,
    error: 'Novig desk trading key is not configured on the server (' + (missing || []).join(', ') + ').',
    missing: missing || [],
  };
}

function locationErrorText(code, message) {
  const c = String(code || '');
  const map = {
    GEOLOCATION_EXPIRED: 'Open the Novig app on your phone to refresh location (needed every 3 days to place).',
    GEOLOCATION_NOT_FOUND: 'Open the Novig app on your phone so it can check your location.',
    GEOLOCATION_FAILED: 'Open the Novig app on your phone and try location again.',
    GEOLOCATION_OUT_OF_BOUNDARY: 'Novig only allows trading from an eligible state. Move to an allowed location, then open the app.',
    GEOLOCATION_BLOCKED_NETWORK: 'Turn off VPN / Private Relay on your phone, then open the Novig app.',
    GEOLOCATION_BLOCKED_SOFTWARE: 'Close remote-desktop or location-spoofing apps, then open the Novig app.',
    RESTRICTED_GEOLOCATION_REGION: 'Your phone location is in a restricted state for Novig.',
    RESTRICTED_NETWORK_REGION: 'This server IP is in a restricted state for Novig signed requests.',
    ANONYMIZED_NETWORK: 'Novig blocked a VPN/proxy/Tor path. Data-center IPs are fine; turn off anonymizers on the request path.',
    INVALID_GEOLOCATION_REGION: 'Open the Novig app so it can record a valid region.',
  };
  if (map[c]) return map[c];
  if (/451|geolocation|location/i.test(String(message || '') + c)) {
    return 'Open the Novig app on your phone to refresh location, then try again.';
  }
  return message || 'Novig rejected the request.';
}

function verifyVectors(vectorsDoc, { signFn = signString, stringFn = stringToSign } = {}) {
  const doc = vectorsDoc || JSON.parse(fs.readFileSync(require('path').join(__dirname, 'novig-signing-vectors.json'), 'utf8'));
  const keys = {};
  for (const [id, kp] of Object.entries(doc.keypairs || {})) {
    keys[id] = crypto.createPrivateKey(kp.private_key_pkcs8_pem);
  }
  const failures = [];
  for (const v of doc.vectors || []) {
    const key = keys[v.keypair_id];
    if (!key) {
      failures.push({ id: v.id, error: 'missing keypair' });
      continue;
    }
    const inp = v.input || {};
    const text = stringFn({
      timestamp: inp.timestamp,
      method: inp.method,
      path: inp.path,
      query: inp.query,
      body: inp.body,
    });
    if (text !== v.string_to_sign) {
      failures.push({ id: v.id, error: 'string_to_sign mismatch' });
      continue;
    }
    const sig = signFn(key, text);
    if (sig !== v.signature) {
      // P-256 DER can be non-unique in theory; verify instead of byte-equal.
      if (key.asymmetricKeyType === 'ed25519') {
        failures.push({ id: v.id, error: 'signature mismatch' });
      } else {
        const pub = crypto.createPublicKey(key);
        const ok = crypto.verify('sha256', Buffer.from(text, 'utf8'), { key: pub, dsaEncoding: 'der' }, Buffer.from(sig, 'base64'));
        if (!ok) failures.push({ id: v.id, error: 'ecdsa verify failed' });
      }
    }
  }
  return { ok: failures.length === 0, total: (doc.vectors || []).length, failures };
}

module.exports = {
  EMPTY_BODY_HASH,
  DEFAULT_PAPER,
  DEFAULT_PROD,
  normalizeCred,
  normalizePem,
  loadPrivateKey,
  canonicalQuery,
  bodyHash,
  stringToSign,
  signString,
  signedHeaders,
  readNovigDeskCreds,
  missingKeysError,
  locationErrorText,
  verifyVectors,
};
