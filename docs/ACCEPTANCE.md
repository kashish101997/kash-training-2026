# Web app acceptance checklist

## Kash OS phone-first release gate

- The four primary destinations are thumb reachable from a fixed bottom navigation bar.
- Today displays unavailable WHOOP values honestly and never derives a value from missing inputs.
- HYROX Mumbai remains active with 6 weeks, 34 sessions, and race day on 18 September 2026.
- The training API and UI expose only the HYROX Mumbai plan; archived catalog plans cannot be enrolled.
- Daily Dharma contains no retired Gita-verse template locally or in the encrypted change feed.
- Body measurements, glucose, journals, meals, workouts, injuries, practices, and completions use encrypted sync entities.
- The app has no horizontal overflow at 320, 375, 393, or 430 CSS pixels.
- Reduced motion disables decorative transitions and ring animation.
- Comet can add Kash OS to the Home Screen and standalone mode respects safe-area insets.
- Apple Health is described as a user-run Shortcut bridge, never direct or background access.

## Automated source checks

- Node tests pass for AES-GCM, merge precedence, privacy rejection, Strava
  mapping/TCX, WHOOP mapping, unavailable metrics, and WHOOP HMAC validation.
- Every JavaScript module parses and JSON configuration validates.
- Service worker v6 excludes authenticated APIs and private migration data from caches.
- Training catalog regeneration retains stable IDs and verifies private source hashes.

## Neon and single-user access

- Apply both numbered migrations to a fresh database and to a copy of the existing database.
- Confirm `/` opens without a redirect, the removed login/auth endpoints return 404, and
  same-origin mutation rejection remains active.
- Inspect encrypted columns and confirm no readable health/OAuth payload is present.
- Test stale edits, same-field precedence, tombstones, duplicate mutation IDs, and offline replay.

## Official WHOOP integration

- Register the exact HTTPS callback and a v2 webhook URL in WHOOP's developer dashboard.
- Complete OAuth consent and verify every requested scope, including `offline`.
- Confirm access/refresh token rotation and concurrent refresh-lease behavior.
- Reconcile 30 days and compare cycle, recovery, sleep, body, and workout summaries with the official
  WHOOP app. Pending or unscorable records must display **Unavailable**, never inferred values.
- Create/edit/delete a test workout; edit sleep by one minute; confirm signed v2 webhook delivery,
  durable insert before `202`, idempotent `trace_id`, background processing, and retry behavior.
- Confirm a v2 recovery webhook resolves its sleep UUID to a cycle before requesting recovery.
- Exercise 429 handling and the hourly missed-event reconciliation.
- Disconnect and confirm WHOOP access is revoked, encrypted tokens are removed, and no new webhooks
  are accepted for the disconnected account.
- Confirm no routes, continuous HR, raw sensor data, ECG, battery, identifiers beyond the WHOOP user
  mapping, or band controls appear in client responses or sync payloads.

## PWA and browser behavior

- Verify install, offline shell, online-only private data, responsive dashboard, reduced motion,
  keyboard navigation, VoiceOver labels, and Dynamic Type/browser text scaling.
- Confirm the app states that official WHOOP data is processed/eventual rather than live streaming.
- Confirm manual/app-only measurements remain usable and no direct HealthKit claim is shown.

## Strava

- Test OAuth cancellation, token rotation, webhook acknowledgement, create/update/delete, privacy
  scopes, rate limits, asynchronous upload failures, and inbound/outbound duplicate loops.
