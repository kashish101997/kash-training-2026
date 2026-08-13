# Private web deployment

## 1. Configure Vercel secrets

Generate independent encryption and cron secrets. Never paste them into source:

```sh
openssl rand -base64 32
```

Set `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `PUBLIC_APP_URL`, and
`CRON_SECRET` in Vercel. `PUBLIC_APP_URL` must be the final HTTPS origin with no trailing slash.
Kash Strap intentionally has no password screen; possession of the deployment URL grants access.

## 2. Create and migrate Neon

```sh
npm install
npm run db:migrate
node Tools/import-data-json.mjs
npm run catalog:build
npm run catalog:import
```

The migration runner applies every numbered SQL file in order and is idempotent. The legacy import
does not modify `data.json`. Verify that the private PWA contains the migrated history before
replacing that file with a non-sensitive marker; it currently contains user edits and must not be
deleted first.

## 3. Configure the official WHOOP app

Create an application in the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/)
and set these Vercel variables:

```text
WHOOP_CLIENT_ID=...
WHOOP_CLIENT_SECRET=...
```

WHOOP currently allows a development app to be used immediately by up to ten members; broad public
distribution requires WHOOP approval, but the private single-user deployment does not.

Register exactly:

```text
Redirect URL: https://YOUR_PRIVATE_DOMAIN/api/whoop/callback
Webhook URL:  https://YOUR_PRIVATE_DOMAIN/api/whoop/webhook
Webhook model: v2
```

The app requests `offline`, `read:profile`, `read:body_measurement`, `read:cycles`,
`read:recovery`, `read:sleep`, and `read:workout`. The `offline` scope is required for refresh-token
rotation. WHOOP uses the OAuth client secret to sign webhooks; do not create a second webhook secret.

After deployment, open Kash Strap and press **Connect WHOOP**. The first callback imports the
profile and then the browser starts a 30-day reconciliation. WHOOP webhook events are durably stored
before the function returns `202` and are processed immediately with `waitUntil`. On Vercel Hobby,
daily retry and reconciliation jobs recover unfinished or missed events and refresh cycles and body
measurements, for which WHOOP currently does not publish webhooks. The UI also exposes an
authenticated manual sync for faster foreground catch-up.

Default WHOOP API limits are 100 requests/minute and 10,000/day. The integration uses collection
pagination, idempotent record versions, and webhook-driven updates to remain comfortably below those
limits for a private account.

## 4. Configure Strava (optional)

Set `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and `STRAVA_WEBHOOK_VERIFY_TOKEN`, then register:

```text
https://YOUR_PRIVATE_DOMAIN/api/strava/callback
```

Inbound activities are webhook-driven after Strava receives them, not a live workout stream.
Outbound publishing remains off until explicitly approved.

## 5. Deploy and verify

Deploy the repository to Vercel, run the acceptance checklist, then inspect Neon to confirm that
`oauth_tokens.encrypted_payload`, `sync_entities.encrypted_payload`, and
`integration_events.encrypted_payload` contain AES-GCM envelopes rather than readable health data.
API responses and `data.json` are network-only and are never service-worker cached.

Disconnecting WHOOP revokes the official OAuth grant and removes its encrypted token. Imported
encrypted summaries remain in private history; deleting that history is a separate explicit data
operation. Rotating `DATA_ENCRYPTION_KEY` requires a controlled decrypt/re-encrypt migration.
