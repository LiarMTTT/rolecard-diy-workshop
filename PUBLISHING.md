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
