#!/usr/bin/env node
// One-time local setup: management key (env only) opens subaccount "desk",
// generates a trading keypair, registers it, writes trading creds to ~/.secrets.
// Never prints private keys. Does NOT fund (funding needs management API —
// Kevin funds via this script's --fund flag locally, or Novig cash wallet UI
// then API transfer).
import { generateKeyPairSync, createPrivateKey, createHash, sign } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

function signText(key, text) {
  const data = Buffer.from(text, 'utf8');
  if (key.asymmetricKeyType === 'ed25519') return sign(null, data, key).toString('base64');
  return sign('sha256', data, { key, dsaEncoding: 'der' }).toString('base64');
}

async function call(host, keyId, key, method, path, body) {
  const data = body === undefined ? '' : JSON.stringify(body);
  const ts = Date.now().toString();
  const digest = createHash('sha256').update(data).digest('hex');
  const text = ['NOVIG-V3', ts, method, path, '', digest].join('\n');
  const res = await fetch(host + path, {
    method,
    body: data || undefined,
    headers: {
      'Novig-Key-Id': keyId,
      'Novig-Timestamp': ts,
      'Novig-Signature': signText(key, text),
      'Content-Type': 'application/json',
    },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const host = (process.env.NOVIG_HOST || 'https://api.paper.novig.com').replace(/\/+$/, '');
const mgmtId = process.env.NOVIG_MGMT_KEY_ID;
const mgmtPem = normalizePem(process.env.NOVIG_MGMT_PRIVATE_KEY || '');
if (!mgmtId || !mgmtPem) {
  console.error('Need NOVIG_MGMT_KEY_ID and NOVIG_MGMT_PRIVATE_KEY in the environment (not printed).');
  process.exit(1);
}
const mgmt = createPrivateKey(mgmtPem);
const label = process.env.NOVIG_DESK_LABEL || 'desk';
const secretsDir = process.env.NOVIG_SECRETS_DIR || join(homedir(), '.secrets');
mkdirSync(secretsDir, { recursive: true, mode: 0o700 });

// Echo first
const echo = await call(host, mgmtId, mgmt, 'POST', '/v3/echo', { hello: 'open-desk' });
if (echo.status !== 200) {
  console.error('Management echo failed', echo.status, echo.json && echo.json.code);
  process.exit(1);
}
console.log('ok: management signature on', host);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const tradingPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const tradingPub = publicKey.export({ type: 'spki', format: 'pem' });

const opened = await call(host, mgmtId, mgmt, 'POST', '/v3/account/subaccounts', {
  label,
  publicKey: tradingPub,
  algorithm: 'Ed25519',
});
if (opened.status !== 201 && opened.status !== 200) {
  console.error('Open subaccount failed', opened.status, opened.json && opened.json.code, opened.json && opened.json.message);
  process.exit(1);
}
const tradingKeyId = opened.json && opened.json.keyId;
if (!tradingKeyId) {
  console.error('Open subaccount returned no keyId');
  process.exit(1);
}

const idPath = join(secretsDir, 'novig-desk-key-id');
const pemPath = join(secretsDir, 'novig-desk.pem');
const envPath = join(secretsDir, 'novig-desk.env');
writeFileSync(idPath, tradingKeyId + '\n', { mode: 0o600 });
writeFileSync(pemPath, tradingPem, { mode: 0o600 });
chmodSync(pemPath, 0o600);
// Env file for Vercel/Railway paste helpers — values stay on disk only.
writeFileSync(
  envPath,
  [
    '# Novig Live Trading Desk trading key (NOT management). Never commit.',
    'NOVIG_DESK_KEY_ID=' + tradingKeyId,
    'NOVIG_API_BASE=' + host,
    '# NOVIG_DESK_PRIVATE_KEY is in novig-desk.pem (PKCS#8). Paste PEM with literal \\n if the host needs one line.',
    '',
  ].join('\n'),
  { mode: 0o600 },
);

console.log('ok: subaccount label=' + JSON.stringify(label));
console.log('ok: trading key id written to', idPath, '(id only; safe to share with deploy)');
console.log('ok: trading PEM written to', pemPath, '(never print / commit)');
console.log('ok: env helper written to', envPath);

const fundAmt = process.env.NOVIG_FUND_AMOUNT || '';
const wantFund = process.argv.includes('--fund') || fundAmt;
if (wantFund) {
  const amount = String(fundAmt || process.argv[process.argv.indexOf('--fund') + 1] || '').trim();
  if (!/^\d+(\.\d{1,5})?$/.test(amount)) {
    console.error('Funding requires --fund <amount> or NOVIG_FUND_AMOUNT (e.g. 100.00000)');
    process.exit(1);
  }
  const path = '/v3/account/subaccounts/' + tradingKeyId + '/transfer';
  const funded = await call(host, mgmtId, mgmt, 'POST', path, {
    direction: 'fund',
    amount: amount.includes('.') ? amount : amount + '.00000',
    clientTransferId: 'desk-fund-' + Date.now(),
  });
  if (funded.status !== 202 && funded.status !== 200) {
    console.error('Fund failed', funded.status, funded.json && funded.json.code);
    process.exit(1);
  }
  console.log('ok: fund accepted status=', funded.json && funded.json.status, 'amount=', amount, '(check Applied before trading)');
} else {
  console.log('note: not funded. Subaccount funding is a management-key API transfer (or use --fund <amount> locally). Kevin must fund before live rests.');
}

console.log('next: put NOVIG_DESK_KEY_ID + NOVIG_DESK_PRIVATE_KEY on Railway/Vercel (trading key only). Keep management key off servers.');
