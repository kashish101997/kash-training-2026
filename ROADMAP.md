# Kash Training Platform — Deferred Roadmap
**Version:** 1.0.0 · **Released:** April 20, 2026
**Live site:** https://kashish101997.github.io/kash-training-2026/
**Main file:** `Kash_Annual_Training_Plan_2026.html` → synced to `index.html` → GitHub Pages

## Versioning Convention

This roadmap uses **semantic versioning** in its header. Bump rules:
- **Patch (1.0.x)** — text tweaks, clarifications, typo fixes.
- **Minor (1.x.0)** — a roadmap item ships (move it out of the list, note in changelog) OR a new item is added.
- **Major (x.0.0)** — roadmap structure/priority tiers change (e.g., new P0 tier, reorganised categories).

The changelog lives at the bottom of this file — grep `## Changelog` to find history.

---

## P1 — Critical (Do These First)

### 1. WhatsApp → Vercel → Platform Sync (Wasender Integration)
**What:** Log weight, workouts, food by texting a WhatsApp number. Data auto-appears on the platform without opening the app.  
**Why:** Daily friction is the enemy. Logging should be as fast as a WhatsApp message.  
**What's already built:**
- `AppState.loadRemote()` polls `data.json` and merges weights, workouts, foodLog, injuries automatically
- `data.json` exists in root folder with correct schema
- Full merge logic handles duplicates, sources, timestamps

**What's needed:**
1. **Vercel serverless function** — receives Wasender webhook POST, parses natural language ("97.2 kg", "ran 8km today", "chicken 40g protein"), writes to `data.json` in repo via GitHub API
2. **Wasender account** — free tier, connect a WhatsApp number, point webhook to Vercel URL
3. **NLP parser** in the Vercel function — simple regex patterns for weight (`\d+\.?\d* ?kg`), workouts, meals
4. **GitHub token** — stored as Vercel env var, used to commit `data.json` updates via GitHub API

**Estimated effort:** 1 session (~3-4 hours)  
**Reference:** `AppState.loadRemote()` at ~line 4068 in main file

---

### 2. Daily Fasting Blood Sugar (FBS) Logging
**What:** Quick-log for daily morning FBS readings (mmol/L or mg/dL). Line chart on Progress tab alongside weight.  
**Why:** Pre-diabetes reversal is the #1 medical goal. FBS should be tracked as obsessively as weight. Currently there's no daily glucose log — only quarterly blood work snapshots.  
**What's already built:**
- Progress tab, weight chart infrastructure, `AppState` + localStorage pattern
- Blood Work Tracker shows quarterly markers but not daily readings

**What's needed:**
1. `AppState.bloodSugar[]` array with same `{date, value}` shape as weights
2. Quick-log modal (reuse existing modal pattern — just change label/placeholder)
3. FBS line chart on Progress tab (reuse `renderWeightChart()` canvas pattern)
4. Dashboard metric card showing latest FBS with target zone (<100 mg/dL / <5.6 mmol/L)
5. Add FBS to WhatsApp parser (e.g., "fbs 98" or "glucose 5.4")

**Estimated effort:** 1 session  

---

## P2 — High Value

### 3. Hemi-Sync / Gateway Audio Button (Dharma Tab)
**What:** "Gateway Audio" button in the Kshatriya Chitta section linking to binaural beat resources for Focus 10 (10 Hz alpha) and Focus 12 (theta 4-7 Hz) practice.  
**Why:** Gateway's real power is the Hemi-Sync technology — the workbook techniques alone are ~40% of the system. The audio entrains brainwaves to the target state. Without it, Focus 10/12 takes months of practice instead of sessions.  
**Free options to link:**
- Monroe Institute's free YouTube channel (official)
- "NSDR 20 min" — Huberman's term for the same state, widely available on YouTube/Spotify
- Insight Timer app — free binaural beats for theta/alpha states

**What's needed:**
1. Small card or button in Block E (Kurukshetra Dhyana) with 2-3 curated links
2. Embed YouTube playlist `<iframe>` (optional — could just be links)
3. Brief explanation: "4 Hz delta = Focus 10 threshold. 7 Hz theta = Focus 12. Use headphones."

**Estimated effort:** 30 minutes

---

### 4. InBody Scan Data Entry
**What:** When Kash gets InBody scans (every 30 days in the plan), input body fat %, muscle mass, visceral fat score, and have them show as a timeline on Progress tab.  
**Why:** The transformation is 98.4 → 78 kg but also BF% drop and muscle retention. Weight alone doesn't tell the full story. InBody retest dates are baked into the training plan (Day 30, 60, 90, 100).  
**What's already built:**
- `AppState.addWeight()` already accepts `bodyFat` and `muscleMass` params
- Progress tab already has a Blood Work Tracker table

**What's needed:**
1. Enhanced weight-log modal — unhide body fat % and muscle mass fields (they exist but are not prominent)
2. Body composition chart on Progress tab — dual-axis line (weight + BF%)
3. InBody scheduled dates highlighted in Progress tab (Apr 11, May 10, Jun 21, Jul 19 = Day 100)

**Estimated effort:** 1 session

---

### 5. Gateway Session Logger
**What:** Log each Focus 10/12 session like a workout — duration, depth reached, key perceptions, pattern change focus. Shows as a timeline.  
**Why:** Monroe's workbook explicitly says "write down your experiences immediately." Over weeks, patterns emerge. Also makes the practice feel accountable like training.  
**What's needed:**
1. `AppState.gatewaySessions[]` — `{date, duration, focus, depth: '10'|'12', notes}`
2. Gateway session log button in Kshatriya Chitta section (reuse existing workout modal pattern)
3. Timeline view in Dharma tab (or Progress tab) showing sessions over 100 days
4. Optional: streak counter for consecutive days with gateway practice

**Estimated effort:** 1 session

---

### 6. HYROX Workout Logger (Station Templates)
**What:** Pre-built workout templates for HYROX-specific sessions. Log time per station (8 stations), total time, compare against target.  
**Why:** HYROX Delhi is Jul 26 — need to track progress on station-specific weaknesses (ski erg, wall balls, rowing times).  
**What's needed:**
1. HYROX workout template in Training tab — 8 station rows with time inputs
2. `AppState.workouts` already exists — extend with `type: 'hyrox'` and station times
3. Progress chart showing station time improvement over training cycle

**Estimated effort:** 1 session

---

## P3 — Nice to Have

### 7. Expanded Astras (5 → 10)
**What:** Expand Pancha Astra to Dasha Astra (10 divine weapons) in the Kshatriya Chitta section.  
**Additional 5 to add:**
- **Vajra** (Indra's thunderbolt) → EBT rapid-fire charging for interval sessions
- **Pashupatastra** (Shiva's weapon) → Full REBAL + Focus 15 (no time) for deep recovery
- **Brahmastra** (Brahma's weapon) → Living Body Map full scan protocol
- **Sudarshana Chakra** (Vishnu's disc) → Emotional Body Map for clearing pre-race mental obstacles
- **Trishul** (three-pronged) → Three-breath emergency return (C-12→C-1 emergency abort)

**Estimated effort:** 30 minutes (HTML only, no new CSS/JS)

---

### 8. Notification / Reminder System
**What:** Push notifications or WhatsApp reminders for: 4:45 AM wake (Brahma Muhurta), pre-run red charge reminder, 10 PM sleep countdown, Sunday Kurukshetra Dhyana.  
**Why:** The Dharma tab practices only work if they're remembered. The whole system is built around 4:45 AM starts.  
**Options:**
- WhatsApp scheduled messages via Wasender (simplest — piggybacks on P1 infrastructure)
- Web Push Notifications via service worker (no backend needed but requires HTTPS + user permission)
- iOS Shortcuts automation (simplest for Kash specifically — no code)

**Estimated effort:** 30 min (iOS Shortcuts) to 2 sessions (full push notification system)

---

### 9. Race Finish Time & Photo Logging
**What:** After each race, log actual finish time, photo, and notes. Compare against goal. Shows in Race Strategy tab and Progress tab.  
**Why:** Bangalore TCSW 10K is Apr 26 — 9 days away. Need a "Race Complete" flow.  
**What's needed:**
1. "Log Race Result" button on each race strategy card
2. `AppState.raceResults[]` — `{raceId, date, time, notes, goalMet: bool}`
3. Visual indicator on race cards: pending → completed with time
4. Progress tab "Race History" section

**Estimated effort:** 1 session

---

## Technical Notes

### Current Architecture
- Single `.html` file, ~3800 lines (post all additions)
- GitHub Pages at `kashish101997.github.io/kash-training-2026`
- LocalStorage key: `kash_fitness_2026_v3`
- Remote data: polls `data.json` in repo root via `AppState.loadRemote()`
- GSAP 3.12.5 + ScrollTrigger for animations

### Vercel Endpoint Shape (for P1)
```
POST /api/log
Body: { type: 'weight'|'workout'|'food', raw: 'the whatsapp message text' }
Response: { ok: true, entry: { date, value, ... } }
Action: commits updated data.json to GitHub via octokit
```

### data.json Schema (already live in repo)
```json
{
  "lastUpdated": "2026-04-17T00:00:00Z",
  "weights": [{ "date": "YYYY-MM-DD", "value": 97.0 }],
  "workouts": [{ "date": "YYYY-MM-DD", "name": "...", "duration": 45 }],
  "foodLog": [{ "date": "...", "name": "...", "protein": 40, "carbs": 0, "fat": 5, "calories": 200 }],
  "injuries": [{ "date": "...", "area": "...", "severity": "mild" }]
}
```

---

## Summary Table

| # | Feature | Priority | Effort | Status |
|---|---|---|---|---|
| 1 | WhatsApp + Vercel webhook | P1 Critical | 1 session | Backend not built |
| 2 | Daily FBS logging | P1 Critical | 1 session | Not started |
| 3 | Hemi-Sync audio links | P2 High | 30 min | Not started |
| 4 | InBody scan data entry | P2 High | 1 session | Partially built (params exist) |
| 5 | Gateway session logger | P2 High | 1 session | Not started |
| 6 | HYROX station templates | P2 High | 1 session | Not started |
| 7 | Expanded Astras (10) | P3 Nice | 30 min | Not started |
| 8 | Notification / reminders | P3 Nice | 30 min–2 sessions | Not started |
| 9 | Race finish time logging | P3 Nice | 1 session | Not started |

---

## Changelog

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
