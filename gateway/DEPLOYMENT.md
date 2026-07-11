# Workshop Gateway Deployment

This guide is for the first VPS deployment of the role-card DIY workshop gateway.

## 0. Build Release Files

From the repository root:

```bash
npm run validate:static
npm run build:pages
npm --prefix gateway run build:release
```

`dist-pages/` is for GitHub Pages. `dist-gateway/` is the minimal VPS Gateway artifact.

For the maintained production VPS, keep the ignored `rolecard-workshop-secrets.secret.json`
at the repository root and let the deploy tool consume it without printing secret values:

```bash
node tools/deploy_gateway_docker.mjs --secretFile rolecard-workshop-secrets.secret.json
node tools/deploy_gateway_docker.mjs --remoteCheck --secretFile rolecard-workshop-secrets.secret.json
```

If the configured private-key path is unavailable, the tool creates a restricted temporary
key from the sealed backup and deletes it when the process exits. Uploaded releases remain
inactive until the new container passes health checks.

In the GitHub repository settings, set Pages source to GitHub Actions. The bundled workflow publishes the static workshop contracts and runtime files; it does not publish the Gateway server process.

## 1. DNS And HTTPS

Point a domain such as `workshop.example.com` to the VPS.

Use Caddy, Nginx, or another reverse proxy for HTTPS. The Node gateway should listen on localhost, for example `127.0.0.1:8787`.

Example Caddyfile:

```caddyfile
workshop.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Example systemd unit:

```ini
[Unit]
Description=Rolecard DIY Workshop Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/rolecard-diy-workshop/gateway
EnvironmentFile=/opt/rolecard-diy-workshop/gateway/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

## 2. Discord OAuth

Create a Discord application and add this redirect URI:

```text
https://workshop.example.com/auth/discord/callback
```

Set these environment variables:

```bash
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://workshop.example.com/auth/discord/callback
DISCORD_GUILD_ID=...
```

`DISCORD_GUILD_ID` is optional for private testing. Set it before public publishing so only server members can publish.

## 3. Gateway Environment

Use long random values for secrets:

```bash
PUBLIC_BASE_URL=https://workshop.example.com
LOGIN_SUCCESS_REDIRECT=https://workshop.example.com/
SESSION_SECRET=...
HASH_SECRET=...
ADMIN_TOKEN=...
CORS_ORIGIN=https://your-sillytavern.example.com
COOKIE_SAME_SITE=None
REQUIRE_REVIEW=true
DEV_LOGIN_ENABLED=false
```

Start from `.env.production.example` on the VPS:

```bash
cp .env.production.example .env
```

Then fill every secret and public URL before starting the service.

`CORS_ORIGIN` must be the exact front-end origin when cookie login is used. Do not use `*` for a public cookie deployment.

Keep `DEV_LOGIN_ENABLED=false` in public deployments. The dev login route exists only for local smoke tests without Discord OAuth.

After the service starts, run:

```bash
npm run self-check
npm run takeover
```

The self-check should have no `FAIL` rows before public publishing. `WARN` rows are acceptable only when they match an intentional private-test setup.

## 4. Cloudreve Storage

Create a public-read Cloudreve folder for package JSON files, for example:

```text
/xingyue/packages/
```

Set:

```bash
PACKAGE_PUBLIC_BASE_URL=https://cloudreve.example.com/f/xingyue/packages
PUBLIC_PACKAGE_DIR=/srv/cloudreve/xingyue/packages
```

The gateway still stores local JSON copies in `PACKAGE_STORE_DIR`. Cloudreve is treated as a public storage hint for package files and optional media. User-uploaded content must remain JSON/media only; do not execute uploaded JavaScript.

If Cloudreve can expose or sync a local server directory, set `PUBLIC_PACKAGE_DIR` to that public-read folder and run:

```bash
npm run sync:public
npm run takeover
```

This copies approved packages to the public folder and removes rejected/withdrawn files from that folder. It does not copy publisher ownership hashes.

For a deployment where Cloudreve owns `/` and Gateway is mounted under `/api/workshop/`, expose Gateway health at:

```text
/api/workshop/health
```

If the reverse proxy should also serve `/health` from Gateway, add a dedicated exact-match location for `/health`.

## 5. Review Flow

With `REQUIRE_REVIEW=true`:

1. Publisher logs in with Discord.
2. Publisher uploads a JSON package.
3. Package is saved as `pending`.
4. Admin checks pending packages:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://workshop.example.com/api/admin/review/packages?status=pending"
```

5. Admin approves or rejects:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}' \
  "https://workshop.example.com/api/admin/review/packages/xingyue-example"
```

Approved packages appear in the public index. Rejected or withdrawn packages do not.

Admins can also use the bundled web page:

```text
https://workshop.example.com/admin
```

Paste `ADMIN_TOKEN`, filter by status/type/search, inspect the package JSON, then approve or reject. The admin page does not display Discord profile fields because the gateway stores only salted hashes and generated publisher IDs.

The same review actions can be done with the bundled CLI:

```bash
npm run review -- list --status pending
npm run review -- approve --id xingyue-example
npm run review -- reject --id xingyue-example --reason "schema issue"
```

After approval or withdrawal, sync the public Cloudreve folder:

```bash
npm run sync:public
```

When a publisher edits package content, the gateway increments `revision`. With `REQUIRE_REVIEW=true`, content changes move the package back to `pending` so the edited JSON must be reviewed again before returning to the public index.

For owner-side updates, pass the last known revision as `X-Package-Revision` or `revision` in the JSON body. Stale edits return `409 package-conflict` instead of overwriting a newer package.

## 6. Privacy Checks

Before public use, confirm the data directory contains only:

- package JSON,
- public index JSON,
- publisher salted hashes and publisher IDs,
- minimal audit log entries.

Do not store Discord email, username, avatar, raw Discord ID, IP history, user agent history, or behavior profiles.
