# Kash Training Platform — Deferred Roadmap
**Version:** 1.1.0 · **Released:** April 21, 2026
**Live site:** https://kashish101997.github.io/kash-training-2026/
**Main file:** `Kash_Annual_Training_Plan_2026.html` → synced to `index.html` → GitHub Pages

## Versioning Convention

This roadmap uses **semantic versioning** in its header. Bump rules:
- **Patch (1.0.x)** — text tweaks, clarifications, typo fixes.
- **Minor (1.x.0)** — a roadmap item ships (move it out of the list, note in changelog) OR a new item is added.
- **Major (x.0.0)** — roadmap structure/priority tiers change (e.g., new P0 tier, reorganised categories).

> **Note (v1.1):** v1.1 absorbed 8 of 9 v1.0 items (FBS, Hemi-Sync, InBody, Gateway logger, HYROX, Dasha Astra, iOS Shortcuts card, race results). Only WhatsApp/Vercel remains — deferred to v2.0 when backend infra is stood up.

The changelog lives at the bottom of this file — grep `## Changelog` to find history.

---

## P1 — Critical (Do These First)

### 1. WhatsApp → Vercel → Platform Sync (Wasender Integration)
> **Only remaining v1.0 item. Awaiting Vercel account + WhatsApp sandbox.**

**What:** Log weight, workouts, food by texting a WhatsApp number. Data auto-appears on the platform without opening the app.  
**Why:** Daily friction is the enemy. Logging should be as fast as a WhatsApp message.  
**What's already built:**
- `AppState.loadRemote()` polls `data.json` and merges weights, workouts, foodLog, injuries automatically
- `data.json` exists in root folder with correct schema
- Full merge logic handles duplicates, sources, timestamps
- **v1.1 addition:** FBS, race results, gateway sessions, HYROX sessions are all now in localStorage — parser just needs to be extended to hit their respective `addX()` methods

**What's needed:**
1. **Vercel serverless function** — receives Wasender webhook POST, parses natural language ("97.2 kg", "ran 8km today", "chicken 40g protein", "fbs 98", "gateway 25 min focus 10"), writes to `data.json` in repo via GitHub API
2. **Wasender account** — free tier, connect a WhatsApp number, point webhook to Vercel URL
3. **NLP parser** in the Vercel function — simple regex patterns for weight, workouts, meals, FBS, gateway sessions
4. **GitHub token** — stored as Vercel env var, used to commit `data.json` updates via GitHub API

**Estimated effort:** 1 session (~3-4 hours)  
**Reference:** `AppState.loadRemote()` at ~line 5023 in main file

---

## Technical Notes

### Current Architecture
- Single `.html` file, ~7700 lines (post v1.1 additions)
- GitHub Pages at `kashish101997.github.io/kash-training-2026`
- LocalStorage key: `kash_fitness_2026_v3`
- Remote data: polls `data.json` in repo root via `AppState.loadRemote()`
- GSAP 3.12.5 + ScrollTrigger for animations

### Vercel Endpoint Shape (for P1)
```
POST /api/log
Body: { type: 'weight'|'workout'|'food'|'fbs'|'gateway', raw: 'the whatsapp message text' }
Response: { ok: true, entry: { date, value, ... } }
Action: commits updated data.json to GitHub via octokit
```

### data.json Schema (extended in v1.1)
```json
{
  "lastUpdated": "2026-04-21T00:00:00Z",
  "weights": [{ "date": "YYYY-MM-DD", "value": 97.0, "bodyFat": 35.4, "muscleMass": 35.7, "visceralFat": 15, "bmr": 1744, "inBody": true }],
  "workouts": [{ "date": "YYYY-MM-DD", "name": "...", "duration": 45 }],
  "foodLog": [{ "date": "...", "name": "...", "protein": 40, "carbs": 0, "fat": 5, "calories": 200 }],
  "injuries": [{ "date": "...", "area": "...", "severity": "mild" }],
  "bloodSugar": [{ "date": "YYYY-MM-DD", "value": 98, "unit": "mg/dL", "notes": "fasted" }],
  "raceResults": [{ "raceId": "bangalore-tcsw-10k", "date": "...", "time": "0:56:30", "goalMet": true, "notes": "..." }],
  "gatewaySessions": [{ "date": "...", "duration": 26, "focus": 10, "depth": "C-10", "notes": "...", "patternChange": "..." }],
  "hyroxSessions": [{ "date": "...", "raceId": "hyrox-delhi", "totalTime": "1:23:45", "stations": { "skiErg": "5:30", ... }, "notes": "..." }]
}
```

---

## Summary Table

| # | Feature | Priority | Effort | Status |
|---|---|---|---|---|
| 1 | WhatsApp + Vercel webhook | P1 Critical | 1 session | Backend not built — the only remaining v1.0 item |

All other v1.0 items shipped in v1.1 — see Changelog below.

---

## Changelog

### v1.1.0 — Apr 21, 2026
**Shipped 8 of 9 v1.0 items in two commits.**

**Data loggers (Commit A):**
- **FBS daily logger** (P1 #2) — `AppState.bloodSugar[]`, `openModal('fbs')`, dashboard metric card with zone coloring (green <100 / amber 100–125 / red ≥126), Progress tab FBS line chart with target-zone bands. Same-day dedup. Lines 4996+ (state), 1898 (card), 5120+ (methods), 3488 (chart).
- **InBody scan upgrade** (P2 #4) — `addWeight()` extended with `{visceralFat, bmr, inBody, notes}` extras, weight modal now has BF% / SMM / VFL / BMR / inBody-checkbox inputs, body-composition dual-axis chart on Progress tab, InBody halo dots + vertical dashed markers (May 10, Jun 21, Jul 21) on weight chart. Blood Work Tracker updated to v3 baseline column. Lines 2000–2064 (card), 5088+ (method), 3561 (table).
- **Race result logger** (P3 #9) — `AppState.raceResults[]`, `openModal('race-result', raceId)`, "+ Log Result" button on every race card with `data-race-id`, status-pill swap (UPCOMING → COMPLETED · time), Race History section on Progress tab. No photo (localStorage quota). Lines 3349–3487 (race cards), 3527 (history).
- **HYROX station-splits** (P2 #6) — `AppState.hyroxSessions[]`, 8-station modal (SkiErg, Sled Push, Sled Pull, Burpee BJ, Row, Farmers Carry, Lunges, Wall Balls) + total time + notes, "+ Log Splits" button on HYROX Delhi + Mumbai cards.
- **`drawLineChart()` helper** — extracted generic canvas charting (zones, markers, y-labels, retina-aware) so new charts are ~15 lines of wrapper code each.

**Dharma content + baseline reconciliation (Commit B):**
- **Pancha Astra → Dasha Astra** (P3 #7) — appended 5 new `.quality-card` divs: Vajra (EBT rapid-fire), Pashupatastra (Full REBAL + Focus 15), Brahmastra (Living Body Map full scan), Sudarshana Chakra (Emotional Body Map pre-race clearing), Trishul (three-breath C-12→C-1 abort). Section header renamed, subtitle notes expansion date. Lines 4062–4139.
- **Gateway Audio card** (P2 #3) — Monroe YouTube sampler, Huberman NSDR, Insight Timer. 4 Hz / 7 Hz / headphone primer. Lines 4140–4240.
- **Gateway session logger** (P2 #5) — `AppState.gatewaySessions[]`, `openModal('gateway-session')` with duration + focus (10/12/15/21) + depth (C-10/C-12/C-15/C-21) + notes + patternChange. Gateway Streak widget (consecutive-day Set). Timeline renders last 10 sessions with "and N more" affordance. Lines ~4240–4260.
- **iOS Shortcuts card** (P3 #8, scaled from full push-notification system) — 4 static recipes with 3-step setup: Brahma Muhurta Alarm (4:45 AM), Pre-Run Red Charge (-15 min), 10 PM Wind-Down, Sunday Kurukshetra Dhyana. No service worker. Footnote references P1 #1 for dynamic WhatsApp reminders. Lines ~4260–4360.
- **InBody baseline card reconciled to Plan v3 PDF** — 3-row layout: Weight 98.4 / BF 35.4% (34.8 kg) / SMM 35.7 kg || BMI 30.4 / VFL 15 / BMR 1744 / Fat to Lose ~20 kg || Blood Panel block: FBS 115 / HbA1c 6.0% / SGPT 55 / CRP 4.0. Header "InBody Scan · v3 Baseline", date "10 Apr 2026". Lines 2000–2064.

**Deferred to v2.0:**
- WhatsApp → Vercel webhook (backend, needs Vercel account + Wasender)

**Deferred indefinitely:**
- Web Push service worker (iOS Shortcuts card covers the need)
- Edit/delete UI for historical entries (manual localStorage edit works)
- Dynamic "is-travelling" mode (Travel tab handles manually)
- Per-station HYROX improvement sparklines (revisit if enough sessions logged)
- Race photos (localStorage quota concern)

### v1.0.0 — Apr 20, 2026
- Initial roadmap release. 9 items across P1 (WhatsApp+Vercel, FBS logging), P2 (Hemi-Sync, InBody data entry, Gateway logger, HYROX templates), and P3 (expanded Astras, reminders, race result logging).
- Includes Vercel endpoint shape and `data.json` schema reference for the WhatsApp integration.
- Semantic versioning convention established at the top of this file.

### Parked in-session (Apr 20, 2026)
Not roadmap items; shipped directly on the same day:
- Plan v3 restructure — 6 phases (added Korea Trip phase between Structured Cut and PSMF Sprint 2).
- Bangalore pre-race guide (Apr 24–26) inside Diet tab.
- Travel tab (8th nav tab) — Korea trip food strategy, hotel gym workouts, Changi layover protocols.
- Weight tracker fix (dedup submitModal, same-day date guard in `addWeight`, chart auto-sort).
