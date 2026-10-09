#!/usr/bin/env node
// Validate NOVIG-V3 signer against Novig's 30 published sample signatures.
// Optional: with NOVIG_MGMT_KEY_ID + NOVIG_MGMT_PRIVATE_KEY, POST /v3/echo on paper.
import { createPrivateKey, createHash, sign, createPublicKey, verify } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(__dirname, '../../api/novig-signing-vectors.json'), 'utf8'));

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
  try { return decodeURIComponent(s); } catch { return s; }
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
  if (body == null || body === '') return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const buf = Buffer.from(String(body), 'utf8');
  if (!buf.length) return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  return createHash('sha256').update(buf).digest('hex');
}
function stringToSign({ timestamp, method, path, query, body }) {
  return ['NOVIG-V3', String(timestamp), String(method).toUpperCase(), path, canonicalQuery(query), bodyHash(body)].join('\n');
}
function signText(key, text) {
  const data = Buffer.from(text, 'utf8');
  if (key.asymmetricKeyType === 'ed25519') return sign(null, data, key).toString('base64');
  return sign('sha256', data, { key, dsaEncoding: 'der' }).toString('base64');
}

const keypairs = Object.fromEntries(
  Object.entries(vectors.keypairs).map(([id, kp]) => [id, createPrivateKey(kp.private_key_pkcs8_pem)]),
);

let fail = 0;
for (const v of vectors.vectors) {
  const key = keypairs[v.keypair_id];
  const text = stringToSign(v.input);
  if (text !== v.string_to_sign) {
    console.error('FAIL', v.id, 'string_to_sign');
    fail++;
    continue;
  }
  const sig = signText(key, text);
  if (key.asymmetricKeyType === 'ed25519') {
    if (sig !== v.signature) {
      console.error('FAIL', v.id, 'signature');
      fail++;
    }
  } else {
    const pub = createPublicKey(key);
    const ok = verify('sha256', Buffer.from(text, 'utf8'), { key: pub, dsaEncoding: 'der' }, Buffer.from(sig, 'base64'));
    if (!ok) {
      console.error('FAIL', v.id, 'ecdsa');
      fail++;
    }
  }
}
if (fail) {
  console.error(fail + ' vector failures');
  process.exit(1);
}
console.log('ok: ' + vectors.vectors.length + ' Novig sample signatures');

const keyId = process.env.NOVIG_MGMT_KEY_ID;
const pem = normalizePem(process.env.NOVIG_MGMT_PRIVATE_KEY || '');
const host = (process.env.NOVIG_HOST || 'https://api.paper.novig.com').replace(/\/+$/, '');
if (keyId && pem) {
  const key = createPrivateKey(pem);
  const body = JSON.stringify({ hello: 'desk-setup' });
  const ts = Date.now().toString();
  const digest = createHash('sha256').update(body).digest('hex');
  const text = ['NOVIG-V3', ts, 'POST', '/v3/echo', '', digest].join('\n');
  const signature = signText(key, text);
  const res = await fetch(host + '/v3/echo', {
    method: 'POST',
    headers: {
      'Novig-Key-Id': keyId,
      'Novig-Timestamp': ts,
      'Novig-Signature': signature,
      'Content-Type': 'application/json',
    },
    body,
  });
  const j = await res.json().catch(() => null);
  if (res.status !== 200) {
    console.error('echo failed', res.status, j && j.code, j && j.message);
    process.exit(1);
  }
  console.log('ok: POST /v3/echo on', host, '(signature accepted; body keys not printed)');
} else {
  console.log('skip echo: set NOVIG_MGMT_KEY_ID + NOVIG_MGMT_PRIVATE_KEY to hit paper echo');
}
