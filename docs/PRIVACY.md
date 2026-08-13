# Data boundary

| Data | Browser | Private Neon | WHOOP API | Strava |
|---|---:|---:|---:|---:|
| Continuous/raw heart rate | No | No | Not available | No |
| Raw sensor frames / IMU / optical | No | No | Not available | No |
| MG ECG | No | No | Not available | No |
| GPS route points | No | No | Not requested | Not imported |
| Workout summary | Yes | Encrypted | Read | Explicit summary export |
| Recovery / sleep / cycle summary | Yes | Encrypted | Read | No |
| WHOOP height / weight / max HR | Yes | Encrypted | Read-only | No |
| App-only tape measurements | Yes | Encrypted | No | No |
| Journal / plan progress | Yes | Encrypted | No | No |
| OAuth tokens | No | AES-256-GCM | Rotated | Rotated |

WHOOP profile storage is minimized to the external user ID and display name; email is not copied into
the sync entity. Tokens are encrypted with account/provider-bound additional authenticated data.
Webhook signatures are checked over the exact raw request body using constant-time comparison,
events are deduplicated by WHOOP `trace_id`, and unmatched account events are ignored.

Only encrypted payloads contain health values. Account/entity IDs, entity kinds, revisions,
tombstones, event status, and timestamps remain indexable so synchronization and retries work.

Apple HealthKit is not available to web browsers. The app uses only a user-run Shortcut bridge and never claims direct or background HealthKit access or
permission state. Manual body data and any future user-initiated Apple Health export import remain
separate from WHOOP's read-only body measurement endpoint.
