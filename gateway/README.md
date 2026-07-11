# Workshop Gateway

Minimal Node.js gateway for the role-card DIY workshop.

Packages published through this gateway are content packages for worldbook/lorebook entries. They are not allowed to act as direct MVU variable patches.

## Responsibilities

- Discord OAuth login.
- Discord guild membership gate.
- Minimal publisher ownership key.
- Package list/detail/publish/update/delete APIs.
- Local JSON file storage for the first deploy.
- Persistent publisher registry keyed by a salted Discord user hash.
- Review gate and minimal audit log.
- Admin review page at `/admin`.
- Mandatory optimistic conflict checks for update, withdraw, and review decisions.
- Shared package-contract validation for Gateway and Xingyue 3.4.0 clients.

## Privacy Contract

The gateway stores only:

- `provider`
- `discordUserHash`
- `publisherId`
- `createdAt`
- `lastLoginAt`

It does not store Discord email, username, avatar, raw Discord ID, IP history, or behavior profiles. Vote records use package-specific HMAC voter keys, so stored voter keys cannot be correlated across packages.

`publisherId` is stable across logins because the gateway maps the salted Discord hash to one generated publisher record. This lets a player update or withdraw their own packages later without storing their raw Discord identity.

Review and withdrawal logs store package ID, publisher ID, action, review status, reason, and timestamp only. They do not store player profile data, IP history, or behavior profiles.

## Run

```bash
cp .env.example .env
npm start
```

Use a reverse proxy such as Nginx/Caddy to provide HTTPS and your public domain.

Cross-origin card clients use `Authorization: Bearer`; Cookie fallback is accepted only for same-origin Gateway pages. `CORS_ORIGIN=*` never enables credentialed CORS.

## API

- `GET /api/workshop/packages`: public package index.
- `GET /api/workshop/packages/:id`: public package detail.
- `GET /api/workshop/health`: Gateway health endpoint for API-prefix reverse proxies.
- `GET /api/workshop/me`: current login state.
- `GET /api/workshop/me/packages`: packages owned by the logged-in publisher.
- `POST /api/workshop/packages`: create a new package; duplicate IDs return `409 package-exists`.
- `PUT /api/workshop/packages/:id`: update an owned package; revision is mandatory.
- `DELETE /api/workshop/packages/:id`: withdraw an owned package; revision is mandatory.
- `POST /api/workshop/packages/:id/vote`: vote on an approved package.
- `GET /api/admin/review/packages?status=pending`: admin review list.
- `GET /api/admin/review/packages/:id`: admin review detail.
- `POST /api/admin/review/packages/:id`: set `approved` or `rejected`; the inspected revision is mandatory.
- `GET /auth/discord/login`: start Discord OAuth.
- `GET /auth/discord/callback`: Discord OAuth callback.

## Storage Notes

The gateway stores package JSON in `PACKAGE_STORE_DIR`, the public index in `INDEX_FILE`, publisher hashes in `PUBLISHER_FILE`, package-scoped HMAC vote keys in `VOTES_FILE`, and audit events in `AUDIT_LOG_FILE`. Login tokens are stateless HMAC tokens containing only publisher ID and expiry, so normal restarts do not invalidate them.

If `REQUIRE_REVIEW=true`, newly published packages are saved as `pending` and do not appear in the public index until an admin approves them. Withdrawing a package marks it as `withdrawn` and removes it from the public index while preserving a minimal audit trail.

`PACKAGE_PUBLIC_BASE_URL` can point at a Cloudreve public folder. The gateway still keeps local JSON copies and uses the Cloudreve URL as the public storage hint in package metadata. Do not use Cloudreve for executable JavaScript uploaded by users.

## Conflict Handling

The gateway adds `revision` and `contentHash` to stored packages. Owners must pass the last known revision when updating or withdrawing; admin review decisions must carry the revision that was inspected:

```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-Package-Revision: 3" \
  --cookie "xy_workshop_session=..." \
  --data @package.json \
  http://localhost:8787/api/workshop/packages/example-id
```

If another update already moved the package to a newer revision, the gateway returns `409 package-conflict`. Content changes move approved packages back to `pending` when `REQUIRE_REVIEW=true`.

## Admin Review Page

Open `/admin`, paste `ADMIN_TOKEN`, then review pending packages. The page stores only the admin token in the browser's localStorage and displays package metadata/payload; it does not display Discord profile fields because the gateway never stores them.

## Maintenance Commands

```bash
npm run review -- list --status pending
npm run review -- approve --id <packageId>
npm run review -- reject --id <packageId> --reason "reason"
npm run sync:public
npm run self-check
npm run takeover
```

`sync:public` copies approved package JSON files from `PACKAGE_STORE_DIR` to `PUBLIC_PACKAGE_DIR` for Cloudreve/public static serving, and removes withdrawn or rejected files from that public directory.

`self-check` checks the live health endpoint, admin API, key environment values, package storage directory, and Cloudreve/public package directory writability.

`takeover` is the server-side re-entry check. It audits `.env`, required secrets, Discord OAuth/guild gate configuration, package storage, public Cloudreve sync settings, privacy-sensitive registry/audit files, and the live API-prefixed Gateway endpoints.
