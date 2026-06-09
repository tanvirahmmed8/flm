# FreeLLMAPI Server Redeploy Guide

This runbook is for your current production style:
- CloudPanel vhost
- Node app managed by systemd
- App listens on port 3004
- Domain proxied to 127.0.0.1:3004

## 1) Pull Latest Code

```bash
cd /home/tanvirsoft-flm/htdocs/flm
git pull origin main
```

## 2) Install And Build

```bash
cd /home/tanvirsoft-flm/htdocs/flm
npm ci
npm run build
```

## 3) Ensure Correct Ownership (important)

```bash
chown -R tanvirsoft-flm:tanvirsoft-flm /home/tanvirsoft-flm/htdocs/flm
mkdir -p /home/tanvirsoft-flm/htdocs/flm/server/data
chmod 775 /home/tanvirsoft-flm/htdocs/flm/server/data
find /home/tanvirsoft-flm/htdocs/flm/server/data -type f -name "*.db*" -exec chmod 664 {} \;
```

## 4) Check Runtime Env

Your app reads `.env`, so verify at least:

```dotenv
ENCRYPTION_KEY=<64-char-hex>
PORT=3004
HOST=127.0.0.1
NODE_ENV=production
DASHBOARD_ORIGINS=https://flm.tanvirsoft.com
```

Quick key length check:

```bash
grep '^ENCRYPTION_KEY=' .env | cut -d= -f2 | awk '{print length}'
```

Expected output: `64`

## 5) Verify systemd Service File

Service file: `/etc/systemd/system/flm.service`

Recommended shape:

```ini
[Unit]
Description=FreeLLMAPI (flm)
After=network.target

[Service]
Type=simple
User=tanvirsoft-flm
WorkingDirectory=/home/tanvirsoft-flm/htdocs/flm
Environment=NODE_ENV=production
Environment=PORT=3004
Environment=HOST=127.0.0.1
Environment=DASHBOARD_ORIGINS=https://flm.tanvirsoft.com
ExecStart=/usr/bin/node server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Important:
- Do not keep stale `Environment=ENCRYPTION_KEY=...` here unless it is the exact old key used to encrypt existing provider keys.
- If present and wrong, keys become undecryptable.

## 6) Restart Service

```bash
systemctl daemon-reload
systemctl restart flm.service
systemctl status flm.service --no-pager -l
```

## 7) Verify Listening And Health

```bash
ss -ltnp | grep :3004
curl -sS http://127.0.0.1:3004/api/ping
curl -sS https://flm.tanvirsoft.com/api/ping
```

Expected ping response:

```json
{"status":"ok","timestamp":"..."}
```

## 8) Verify API

```bash
curl -sS https://flm.tanvirsoft.com/v1/models -H "Authorization: Bearer YOUR_UNIFIED_KEY"
```

## 9) Common Failures

### A) Invalid ENCRYPTION_KEY
Error example:
- `Invalid ENCRYPTION_KEY (env): expected 64 hex chars...`

Fix:
1. Put back the original key used when provider keys were added.
2. Restart service.
3. If original key is lost, delete and re-add provider keys.

### B) attempt to write a readonly database
Error example:
- `attempt to write a readonly database`

Fix:
1. Correct ownership and perms of `/home/tanvirsoft-flm/htdocs/flm` and `/server/data`.
2. Restart service.

### C) 429 All models exhausted
Typical causes:
1. Keys are undecryptable (`[decrypt failed]`).
2. All keys disabled/invalid/rate-limited.
3. Fallback models are toggled off.

Fix checklist:
1. Keys page: ensure keys decrypt and show healthy or unknown.
2. Fallback page: keep multiple enabled models/providers.
3. Run health check all.

## 10) Useful Debug Commands

```bash
journalctl -u flm.service -n 120 --no-pager
systemctl show flm.service -p Environment -p ExecMainStatus -p NRestarts
ls -lah /home/tanvirsoft-flm/htdocs/flm/server/data
```

## 11) Fast Redeploy One-Liner Sequence

```bash
cd /home/tanvirsoft-flm/htdocs/flm && git pull origin main && npm ci && npm run build && chown -R tanvirsoft-flm:tanvirsoft-flm /home/tanvirsoft-flm/htdocs/flm && systemctl daemon-reload && systemctl restart flm.service && systemctl status flm.service --no-pager -l
```
