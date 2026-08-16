# Kash OS

Kash OS is a personal single-user, phone-first Health OS. The maintained product is a PWA
for Vercel, backed by encrypted Neon Postgres records, the official WHOOP Developer API, and the
official Strava API. There is no direct Bluetooth connection and no subscription bypass.

## Current product

- Four thumb-reachable phone surfaces: Today, Train, Progress, and Library.
- A daily command center with processed WHOOP recovery/sleep/strain, deterministic guidance,
  today's session, editable Dharma micro-practices, and Quick Log.
- Standalone Comet/Home Screen installation under the **Kash OS** name.

- Official WHOOP OAuth 2.0 with encrypted, rotating access and refresh tokens.
- WHOOP v2 profile, body measurement, cycle, recovery, sleep, and workout import.
- Signed v2 WHOOP webhook ingestion for workout, sleep, and recovery updates, plus hourly
  reconciliation for events or cycle/body changes that webhooks do not cover.
- Honest dashboard states for pending, unscorable, or absent WHOOP metrics.
- WHOOP workouts mapped into the existing training log without routes or high-frequency streams.
- Password-free access through the publicly reachable personal URL, AES-256-GCM encrypted Neon payloads, idempotent mutations,
  audit history, tombstones, and user-edit precedence.
- One visible HYROX Mumbai plan through 18 September 2026, plus plan progress, nutrition,
  measurements, reports, and the PWA offline shell. Other imported plans are tombstoned in the
  encrypted catalog and can only be restored by an explicit private catalog reimport.
- Strava OAuth, webhook imports, refresh-token rotation, and explicit summary-only exports.

## Official API boundaries

WHOOP's official API is processed account data, not a live band transport. It does not expose
continuous heart rate, battery state, raw sensors, ECG, route points, haptic controls, or firmware
operations. Webhook updates arrive after WHOOP processes an activity. Body measurements are
read-only through the API. The API is account-scoped and does not provide a reliable 5.0/MG-only
hardware gate, so the previous model selector has been retired.

A browser cannot call Apple HealthKit. Kash OS therefore includes a documented, user-run Shortcut
bridge for supported body measurements and blood glucose. It is not direct or background HealthKit
access; unsupported tape measurements remain Kash OS only.

See the official [WHOOP OAuth guide](https://developer.whoop.com/docs/developing/oauth/),
[WHOOP API reference](https://developer.whoop.com/api/), and
[WHOOP webhook guide](https://developer.whoop.com/docs/developing/webhooks/).

## Run locally

```sh
npm install
npm test
```

The PWA needs a Postgres database and integration secrets before its APIs can run. Copy
`.env.example` into a local secret manager, then follow [Deployment](docs/DEPLOYMENT.md).

## Repository layout

- `index.html`, `app/`: maintained Kash OS client shell and ES modules.
- `legacy.html`: one-release rollback and reference copy of the previous annual-plan interface.
- `api/`, `lib/`, `db/`: Vercel functions, integrations, encryption, and private storage.
- `Tools/TrainingCatalogBuilder`: private local plan generator; purchased source content stays ignored.
- `ios/`: archived v4 native prototype, excluded from the maintained web product and deployment.

The NOOP/OpenStrap-derived native prototype and notices remain archived for provenance. No NOOP or
OpenStrap protocol code is used by the v6 deployed web app.
