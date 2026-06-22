# External Chain Takeover Report

Date: 2026-06-22
Repository: https://github.com/LiarMTTT/rolecard-diy-workshop
Gateway: https://43-132-171-157.sslip.io
GitHub Pages: https://liarmttt.github.io/rolecard-diy-workshop
VPS host: 43.132.171.157

## Current Git State

- Branch: `main`
- Latest pushed commit: `7f59aa8469aabb970ab93a9dcfc9f7f6d22676c9`
- Commit message: `Add workshop ops takeover checks`
- Local working tree: clean after this report is committed
- Repository-local Git proxy:
  - `http.proxy=http://127.0.0.1:7897`
  - `https.proxy=http://127.0.0.1:7897`

The proxy setting is local to this repository and is required because direct command-line TCP access to `github.com:443` failed from this machine, while the local Clash Verge proxy on port `7897` could reach GitHub.

## New Takeover Tools

- `npm run ops:takeover`
  - Runs from the repository root.
  - Checks Git state, local validation, GitHub Pages, public Gateway endpoints, CORS, Discord OAuth route, admin protection, SSH known host/private key, and optional remote SSH checks.

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
- OK: CORS allows `http://127.0.0.1:8000`.
- OK: SSH known host exists for `43.132.171.157`.
- WARN: admin API is protected and needs `ADMIN_TOKEN` to verify.
- WARN: Discord OAuth route exists, but `DISCORD_CLIENT_ID` is empty on the deployed Gateway.
- WARN: no private SSH key exists in `C:\Users\Administrator\.ssh`.
- FAIL: `/api/workshop/health` returns `404` because the VPS has not deployed the new Gateway code yet.

## Local Release Artifact

Release package prepared locally:

```text
C:\Users\Administrator\OneDrive\ST-\角色卡工作区\rolecard-diy-workshop\dist-gateway.zip
```

SHA256:

```text
134B0CDE3925C2C4AA0960561457D7222C11BA3FD26C4A349EBAF9440530C979
```

The zip is ignored by Git and should be uploaded manually or copied with `scp` once SSH access is available.

## Remaining External Blockers

1. VPS SSH access is blocked from this machine.
   - `C:\Users\Administrator\.ssh` has `known_hosts`, but no private key.
   - Remote deployment cannot be completed by automation until an SSH key or server console access is available.

2. Discord OAuth is not configured on the VPS.
   - Configure `DISCORD_CLIENT_ID`.
   - Configure `DISCORD_CLIENT_SECRET`.
   - Configure callback URL:
     `https://43-132-171-157.sslip.io/auth/discord/callback`
   - Configure `DISCORD_GUILD_ID` before public publishing if member-only publishing is required.

3. Admin verification needs `ADMIN_TOKEN`.
   - The Gateway protects admin review APIs correctly.
   - Set `ADMIN_TOKEN` in the server environment and provide it only through a secure local environment variable when running admin checks.

4. Cloudreve public package sync still needs server-side confirmation.
   - Set `PUBLIC_PACKAGE_DIR` to the Cloudreve public JSON folder path on the VPS.
   - Set `PACKAGE_PUBLIC_BASE_URL` to the public Cloudreve package URL.
   - Run `npm run sync:public` after approving packages.

## VPS Deployment Commands

After SSH or server-console access is available, deploy the new Gateway release:

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
cd C:\Users\Administrator\OneDrive\ST-\角色卡工作区\rolecard-diy-workshop
git pull
npm run check
npm run ops:takeover -- --corsOrigin http://127.0.0.1:8000
```
