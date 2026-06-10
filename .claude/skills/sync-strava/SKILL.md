---
name: sync-strava
description: Pull recent activities from the Strava MCP, map them to the platform's workouts schema, dedupe against data.json, commit and push. Use when the user says "sync strava", "/sync-strava", "pull my runs", or after they mention completing a run that should appear on the platform.
---

# Sync Strava → data.json

Pull the user's recent Strava activities via the **official Strava MCP connector** and land them in `data.json` so the platform (loadRemote merge) picks them up.

## Preconditions

- The Strava MCP must be connected (tools will appear as `mcp__strava__*` or similar). If its tools are deferred, load them with ToolSearch (query "strava"). If no Strava tools exist at all, STOP and tell the user to connect the Strava MCP connector first (Settings → Connectors in Claude, or `claude mcp add` — see https://support.strava.com/hc/en-us/articles/46190267796237).
- Work in the project root: `/Users/kashish/Desktop/Project Kash 2026/`.

## Procedure

1. **Read `data.json`** (project root). Note:
   - `lastStravaSync` (ISO timestamp, top level). If absent, default window = last 14 days.
   - The existing `workouts` array (for dedupe).

2. **Fetch activities** from the Strava MCP since `lastStravaSync` (or the 14-day window). Only sync activity types: `Run`, `TrailRun`, `Walk` (if ≥3km), `Workout`, `WeightTraining`, `Hike`. Skip everything else (rides, swims can be added later if the user asks).

3. **Map each activity** to the workouts schema used by `submitWorkoutFeedback()`:

   ```js
   {
     date:      start_date_local sliced to "YYYY-MM-DD",
     name:      activity name from Strava (escape nothing here — stored as data; UI escapes via escHTML),
     completed: true,
     distance:  km, 1 decimal (null for non-distance workouts),
     pace:      decimal min/km = (moving_time_sec/60) / km (null if no distance),
     paceStr:   "M:SS" per km from moving_time (null if no distance),
     duration:  Math.round(moving_time_sec / 60),
     hr:        Math.round(average_heartrate) or null,
     rpe:       perceived_exertion if present, else 5,
     notes:     "Synced from Strava · https://www.strava.com/activities/<id>",
     load:      distance ? +(distance * rpe).toFixed(1) : +((duration/10) * rpe).toFixed(1),
     source:    "strava"
   }
   ```

   **Type field**: add `type: "running"` for Run/TrailRun, `"strength"` for WeightTraining/Workout, `"recovery"` for Walk/Hike — matching the values the manual modal uses.

4. **Dedupe** — skip an activity if EITHER:
   - a workout with same `(date, name)` already exists (the loadRemote merge key), OR
   - a same-date workout of type running exists with `|distance delta| ≤ 0.3 km` (catches manually-logged versions of the same run, e.g. race entries).

5. **Write `data.json`**: append surviving entries to `workouts` (keep array sorted by date ascending), set `lastUpdated` and `lastStravaSync` to now (ISO, +05:30 offset).

6. **Commit + push**:
   ```
   git add data.json
   git commit -m "data: strava sync — <N> activities (<date range>)"
   git push
   ```

7. **Report** to the user: a short table of what was synced (date, name, distance, pace) and what was skipped as duplicate. If zero new activities, say so plainly.

## Guardrails

- Never modify or delete existing workout entries — append only.
- Race days: if a synced run falls on a known race date (check `raceResults`), keep the manual race entry authoritative — skip the Strava version if distances are within 0.5km.
- Strava MCP is read-only; never attempt writes to Strava.
- If `git push` fails (offline / auth), leave the commit local and tell the user.
