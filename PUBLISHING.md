# Publishing Checklist

This checklist moves the workshop from local files to GitHub Pages plus the VPS Gateway.

## GitHub Pages

1. Validate and build locally:

```bash
npm run check
npm run build:pages
```

2. Commit and push to `main`.

3. In GitHub repository settings, set Pages source to GitHub Actions.

4. Confirm the workflow `Deploy static workshop pages` finishes successfully.

5. Confirm these URLs are reachable:

```text
https://liarmttt.github.io/rolecard-diy-workshop/workshop-index.json
https://liarmttt.github.io/rolecard-diy-workshop/cards/xingyue/index.json
https://liarmttt.github.io/rolecard-diy-workshop/runtime/xingyue/2.9.0/manifest.json
```

GitHub Pages publishes only static contracts, schemas, examples, indexes, and official runtime files. It does not host player package uploads or the Gateway server.

## Gateway VPS

1. Build the release artifact:

```bash
npm --prefix gateway run build:release
```

2. Copy `dist-gateway/` to the VPS, for example:

```bash
rsync -av dist-gateway/ user@workshop.example.com:/opt/rolecard-diy-workshop/gateway/
```

3. On the VPS:

```bash
cd /opt/rolecard-diy-workshop/gateway
cp .env.production.example .env
```

4. Fill `.env` with:

- public Gateway domain,
- Discord OAuth credentials,
- Discord guild ID,
- random `SESSION_SECRET`, `HASH_SECRET`, and `ADMIN_TOKEN`,
- exact SillyTavern/Cards front-end `CORS_ORIGIN`,
- Cloudreve public package URL and local public folder path.

5. Start or restart the systemd service.

6. Run:

```bash
npm run self-check
```

7. Open:

```text
https://workshop.example.com/admin
```

8. Test the full flow:

- Discord login,
- publish JSON package,
- package appears as `pending`,
- admin approves,
- `npm run sync:public`,
- package appears in the public index,
- owner withdraws package,
- `npm run sync:public` removes it from the public folder.

Do not enable `DEV_LOGIN_ENABLED=true` on a public deployment.

## Fast Takeover

From the repository root, run:

```bash
npm run ops:takeover
```

For the P1 external-chain acceptance pass, use the single bundled check instead of repeating partial checks:

```bash
npm run ops:p1
```

This runs local static/Gateway syntax checks once, verifies GitHub Pages, the public Gateway, Discord OAuth redirect, admin protection, SSH takeover, the remote Gateway self-check, and the common local preview/SillyTavern CORS origins:

```text
http://127.0.0.1:8000
http://localhost:8000
http://127.0.0.1:8766
http://localhost:8766
```

Useful options:

```bash
npm run ops:takeover -- --gatewayUrl https://198-23-196-145.sslip.io
npm run ops:takeover -- --corsOrigin http://127.0.0.1:8000
npm run ops:takeover -- --ssh --vpsUser root --vpsHost 198.23.196.145
```

The takeover check verifies:

- Git remote/upstream/worktree state,
- local static and Gateway syntax/build checks,
- GitHub Pages public URLs,
- Gateway public index, API-prefixed health endpoint, admin page, login state, Discord redirect, and admin route protection,
- CORS headers for the expected front-end origin,
- SSH known host/private key availability, and optional remote Gateway self-check.

On the VPS, after deploying `dist-gateway/`, run:

```bash
cd /opt/rolecard-diy-workshop/gateway
npm run takeover
```

The server-side takeover check verifies `.env`, required secrets, Discord OAuth/guild gate configuration, storage directories, publisher/audit privacy, Cloudreve/public-folder sync config, and live Gateway API endpoints.

For the current Docker deployment, rebuild the Gateway container from the repository root with:

```bash
npm run deploy:gateway-docker
```

The deploy helper reuses the existing VPS `.env`, backs it up, appends the standard local preview CORS origins if they are missing, recreates the `rolecard-workshop-gateway` container with the existing bind mounts, checks `https://198-23-196-145.sslip.io/api/workshop/health`, and automatically restores the old container if the health check fails. It does not store or print Discord secrets, admin token, session secret, hash secret, or private SSH key content.

For the current Cloudreve-root deployment, keep Gateway health under the API prefix:

```text
https://198-23-196-145.sslip.io/api/workshop/health
```

If you also want `/health` to hit Gateway instead of Cloudreve, add an Nginx location equivalent to:

```nginx
location = /health {
  proxy_pass http://127.0.0.1:8787/health;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```
