# Novig Live Trading Desk — local key setup

Management key stays on Kevin’s machine only. Trading key goes to Railway/Vercel.

## What Novig’s Profile “Create Key” produces

On paper.novig.com or novig.com → Profile → Settings → **Novig API** → **Create Key**:

1. Browser generates **Ed25519** when possible, otherwise **P-256**.
2. Downloads `novig-api-key-<nickname>.pem` (PKCS#8 private key).
3. Shows the **key id** (UUID) beside the private key once.
4. That first key is the **management** key (opens/funds subaccounts; cannot trade).

## Env vars to paste into a secure request (management, one-time, local)

```
NOVIG_MGMT_KEY_ID=<uuid from Novig UI>
NOVIG_MGMT_PRIVATE_KEY=<full PKCS#8 PEM, or one line with \n escapes>
NOVIG_HOST=https://api.paper.novig.com
```

Prefer paper first. For production later: `NOVIG_HOST=https://api.novig.com` and a **production** management key (paper keys do not work on prod).

## Commands

```bash
# 1) Offline: prove our signer matches Novig’s 30 sample signatures
node /workspace/novig-setup/validate-vectors.mjs

# 2) With management env set: echo on paper, then open "desk" subaccount
node /workspace/novig-setup/validate-vectors.mjs
node /workspace/novig-setup/open-desk-subaccount.mjs
# optional fund (management API only):
# node /workspace/novig-setup/open-desk-subaccount.mjs --fund 100.00000
```

Writes (mode 600) under `~/.secrets/`:

- `novig-desk-key-id`
- `novig-desk.pem` (trading private key)
- `novig-desk.env`

## Server env (trading key only — never management)

```
NOVIG_DESK_KEY_ID=...
NOVIG_DESK_PRIVATE_KEY=...   # PEM; \n-escaped one-liner OK
NOVIG_API_BASE=https://api.paper.novig.com   # or https://api.novig.com
```

## Funding

Subaccount funding is done with the **management** key via  
`POST /v3/account/subaccounts/{tradingKeyId}/transfer`.  
The setup script does not fund unless you pass `--fund`. Kevin can fund from this box with management env set, then unset it.
