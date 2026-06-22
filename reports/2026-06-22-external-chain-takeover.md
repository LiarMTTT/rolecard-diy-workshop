# External Chain Takeover Report

Date: 2026-06-22
Repository: https://github.com/LiarMTTT/rolecard-diy-workshop
Gateway: https://43-132-171-157.sslip.io
GitHub Pages: https://liarmttt.github.io/rolecard-diy-workshop
VPS host: 43.132.171.157

## Current Git State

- Branch: `main`
- Latest functional commit: `c755123b6ca436e0532e8fce2e4eded44edd0d29`
- Functional commit message: `Support Docker gateway SSH takeover`
- Local working tree: clean after this report is committed
- Repository-local Git proxy:
  - `http.proxy=http://127.0.0.1:7897`
  - `https.proxy=http://127.0.0.1:7897`

The proxy setting is local to this repository and is required because direct command-line TCP access to `github.com:443` failed from this machine, while the local Clash Verge proxy on port `7897` could reach GitHub.

## New Takeover Tools

- `npm run ops:takeover`
  - Runs from the repository root.
  - Checks Git state, local validation, GitHub Pages, public Gateway endpoints, CORS, Discord OAuth route, admin protection, SSH known host/private key, and optional remote SSH checks.
  - Remote SSH checks support the current Docker deployment through the `rolecard-workshop-gateway` container.

- `npm --prefix gateway run takeover`
  - Runs on the VPS inside the Gateway directory.
  - Checks `.env`, required secrets, Discord OAuth/guild gate, storage directories, Cloudreve public sync config, publisher/audit privacy, and HTTP endpoints.

## Validation Completed

These checks passed locally:

```powershell
npm run check
npm --prefix gateway run build:release
```

The public takeover check reported:

- OK: GitHub remote/upstream and clean worktree.
- OK: GitHub Pages public static files.
- OK: local validation and Gateway release build.
- OK: Gateway public package index.
- OK: Gateway admin page is reachable.
- OK: `/api/workshop/me` returns unauthenticated state.
- OK: `/api/workshop/health` returns `200`.
- OK: CORS allows `http://127.0.0.1:8000`.
- OK: SSH known host exists for `43.132.171.157`.
- OK: SSH private key exists at `C:\Users\Administrator\.ssh\xingyue_workshop_vps_ed25519`.
- OK: Remote Gateway self-check runs inside Docker container `rolecard-workshop-gateway`.
- WARN: admin API is protected and needs `ADMIN_TOKEN` to verify.
- WARN: Discord OAuth route exists, but `DISCORD_CLIENT_ID` is empty on the deployed Gateway.

When `ADMIN_TOKEN` is available in the local environment, server self-check confirms the admin API accepts it.

## Local Release Artifact

Release package prepared locally:

```text
<workspace>\rolecard-diy-workshop\dist-gateway.zip
```

SHA256:

```text
134B0CDE3925C2C4AA0960561457D7222C11BA3FD26C4A349EBAF9440530C979
```

The zip is ignored by Git and should be uploaded manually or copied with `scp` once SSH access is available.

## Remaining External Blockers

1. Discord OAuth is not configured on the VPS.
   - Configure `DISCORD_CLIENT_ID`.
   - Configure `DISCORD_CLIENT_SECRET`.
   - Configure callback URL:
     `https://43-132-171-157.sslip.io/auth/discord/callback`
   - Configure `DISCORD_GUILD_ID` before public publishing if member-only publishing is required.

2. Cloudreve public package sync still needs server-side confirmation.
   - Set `PUBLIC_PACKAGE_DIR` to the Cloudreve public JSON folder path on the VPS.
   - Set `PACKAGE_PUBLIC_BASE_URL` to the public Cloudreve package URL.
   - Run `npm run sync:public` after approving packages.

## VPS Deployment Commands

SSH access is available with:

```powershell
ssh xingyue-workshop-vps
```

To deploy a future Gateway release:

```bash
cd /opt/rolecard-diy-workshop/gateway
cp .env .env.bak.$(date +%Y%m%d%H%M%S)
```

Upload the local `dist-gateway.zip` contents into `/opt/rolecard-diy-workshop/gateway`, preserving the existing `.env`.

Then run:

```bash
npm run check
npm run takeover
systemctl restart rolecard-diy-workshop-gateway || docker restart rolecard-workshop-gateway
curl https://43-132-171-157.sslip.io/api/workshop/health
```

Expected health response after deployment:

```json
{"ok":true}
```

## Local Commands For Next Takeover

```powershell
cd <workspace>\rolecard-diy-workshop
git pull
npm run check
node tools/ops_takeover.mjs --corsOrigin http://127.0.0.1:8000 --ssh xingyue-workshop-vps
```
