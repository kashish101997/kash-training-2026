# Kash Training Platform — Deferred Roadmap
**Version:** 2.5.0 · **Released:** April 25, 2026
**Live site:** https://kashish101997.github.io/kash-training-2026/
**Main file:** `Kash_Annual_Training_Plan_2026.html` → synced to `index.html` → GitHub Pages

## Versioning Convention

This roadmap uses **semantic versioning** in its header. Bump rules:
- **Patch (2.x.y)** — text tweaks, clarifications, hotfix-only commits.
- **Minor (2.y.0)** — a tranche ships (move it out of the list, note in changelog) OR a new tranche is added.
- **Major (x.0.0)** — roadmap structure/priority tiers change (e.g., new P0 tier, reorganised categories).

> **Note (v2.5):** v2.5 absorbed every previously-planned v2.0 Tranche 2 (VO2/pace zones/PRs/ACWR) and Tranche 3 (heatmap/photos/measurements) feature into the editorial revamp itself, rather than shipping an empty redesign followed by a feature rebuild. The result is a single coherent v2.5.0 ship across four tranches (R1–R4).

The changelog lives at the bottom of this file — grep `## Changelog` to find history.

---

## P1 — Critical (Do These First)

### 1. WhatsApp → Vercel → Platform Sync (Wasender Integration)
> **Only remaining v1.0 item. Awaiting Vercel account + WhatsApp sandbox. Not blocking — paste-into-Apple-Health and CSV export cover the manual path in v2.5.**

**What:** Log weight, workouts, food, FBS, gateway sessions, strength PRs, measurements by texting a WhatsApp number. Data auto-appears on the platform without opening the app.
**Why:** Daily friction is the enemy. Logging should be as fast as a WhatsApp message.
**What's already built:**
- `AppState.loadRemote()` polls `data.json` and merges weights, workouts, foodLog, injuries, FBS, gateway sessions, HYROX, race results, **strength PRs (v2.5-c), measurements (v2.5-d)** automatically
- `data.json` exists in root folder with correct schema
- Full merge logic handles duplicates, sources, timestamps, with `_isMerging` flag preventing mid-merge `save()` overwrites (v2.0-a)

**What's needed:**
1. **Vercel serverless function** — receives Wasender webhook POST, parses natural language ("97.2 kg", "ran 8km today", "deadlift 140 kg x3", "waist 88 cm", "fbs 98", "gateway 25 min focus 10"), writes to `data.json` in repo via GitHub API
2. **Wasender account** — free tier, connect a WhatsApp number, point webhook to Vercel URL
3. **NLP parser** in the Vercel function — regex patterns for all 11 data types now in `AppState`
4. **GitHub token** — stored as Vercel env var, used to commit `data.json` updates via GitHub API

**Estimated effort:** 1 session (~3-4 hours)
**Reference:** `AppState.loadRemote()` at ~line 6011 in main file

---

## P2 — Deferred to v2.5.1 / v3.0

### 2. Progress Photo Timeline (deferred from v2.5-d / R4)
> **Cut from R4 due to scope.** All other R4 features (heatmap, badges, weekly digest, Cmd+K, custom cursor, body measurements) shipped.

**What:** Two-photo before/after comparison with draggable divider. Gallery view of last N photos. Side-by-side view at any two dates.
**Why:** Visual transformation is the most motivating data. Numbers lie; mirrors don't.
**Why not in v2.5-d:** localStorage 5MB quota cannot hold even 2 phone photos. Needs IndexedDB.
**What's needed:**
1. IndexedDB wrapper (~80 lines) — open DB, add photo, list photos, delete photo
2. EXIF strip + downscale to 1024px on upload (~30 lines using canvas)
3. Slider UI with draggable divider (CSS `clip-path` animation)
4. Quota-check helper — warn when DB exceeds 50MB; offer to delete oldest

**Estimated effort:** 1 session (~3 hours)

### 3. Apple Health JSON Import
> **Cut from v2.5-d.** iOS Shortcuts card already covers the manual path; full JSON paste modal is polish.

**What:** Paste-from-clipboard modal that consumes the JSON exported by an Apple Health iOS Shortcut and batch-logs weights, workouts, sleep without dupes.
**Why:** Whoop / Apple Watch users already have months of data sitting in Health.app. Make import a one-tap operation.
**Estimated effort:** ~2 hours (parser + dedup against existing dates).

### 4. Edit/Delete UI for Progress rows
> **Manual localStorage edit still works as escape hatch.**

**What:** Long-press / right-click on any Progress-tab row opens an edit modal with the row's current values; "Delete" button with confirm-toast undo.
**Estimated effort:** ~3 hours.

---

## Technical Notes

### Current Architecture (v2.5.0)
- Single `.html` file, **~11,800 lines** (post v2.5-d)
- GitHub Pages at `kashish101997.github.io/kash-training-2026`
- LocalStorage key: `kash_fitness_2026_v3`; sessionStorage fallback on quota errors
- Remote data: polls `data.json` in repo root via `AppState.loadRemote()`
- GSAP 3.12.5 + ScrollTrigger + **Lucide UMD** (ShadCN-style icons) for animations & iconography
- **PWA-capable** — `manifest.json`, `service-worker.js`, iOS smart-banner, OG/Twitter meta
- Two animation systems with strict boundary: `animateTabContent()` owns `#panel-dashboard`; `sectionReveals()` owns the other 7 tabs (deduped via `__v3: true` + `data-v3-reveal`)
- Class-based tab visibility: `.tab-panel.active` / `.tab-panel { display: none }`; lazy re-query on every `switchTab()`
- All scroll listeners are `requestAnimationFrame`-throttled. **No `ScrollTrigger.pin` on mobile** (matchMedia ≥768px gate) to avoid iOS Safari jank.
- Custom cursor (desktop only, `pointer: fine`, reduced-motion gated)
- Cmd+K palette indexes 8 tabs + 6 log shortcuts + 2 actions + recent 30 workouts/races

### Data shapes (extended through v2.5)
```json
{
  "lastUpdated": "2026-04-25T00:00:00Z",
  "weights":         [{ "date": "...", "value": 97.0, "bodyFat": 35.4, "muscleMass": 35.7, "visceralFat": 15, "bmr": 1744, "inBody": true }],
  "workouts":        [{ "date": "...", "name": "...", "duration": 45 }],
  "foodLog":         [{ "date": "...", "name": "...", "protein": 40, "carbs": 0, "fat": 5, "calories": 200 }],
  "injuries":        [{ "date": "...", "area": "...", "severity": "mild" }],
  "bloodSugar":      [{ "date": "...", "value": 98, "unit": "mg/dL", "notes": "fasted" }],
  "raceResults":     [{ "raceId": "...", "date": "...", "time": "0:56:30", "goalMet": true, "notes": "..." }],
  "gatewaySessions": [{ "date": "...", "duration": 26, "focus": 10, "depth": "C-10", "notes": "...", "patternChange": "..." }],
  "hyroxSessions":   [{ "date": "...", "raceId": "...", "totalTime": "1:23:45", "stations": { ... }, "notes": "..." }],
  "strengthPRs":     [{ "date": "...", "lift": "Deadlift", "weight": 140, "reps": 3, "notes": "..." }],
  "measurements":    [{ "date": "...", "waist": 92, "hip": 104, "chest": 110, "thigh": 64, "arm": 38, "calf": 41, "neck": 41 }],
  "milestoneBadges": [{ "id": "first-workout", "label": "Bar Touched", "earnedAt": "..." }],
  "prCelebrationsSeen": ["Deadlift|2026-04-22|140"],
  "dharmaChecks":    { "2026-04-25": { "wake": true, "ebt-am": true } }
}
```

### Vercel Endpoint Shape (for P1)
```
POST /api/log
Body: { type: 'weight'|'workout'|'food'|'fbs'|'gateway'|'pr'|'measurement', raw: 'whatsapp message text' }
Response: { ok: true, entry: { date, value, ... } }
Action: commits updated data.json to GitHub via octokit
```

---

## Summary Table

| # | Feature | Priority | Effort | Status |
|---|---|---|---|---|
| 1 | WhatsApp + Vercel webhook | P1 Critical | 1 session | Backend not built — only remaining v1.0 item |
| 2 | Progress Photo Timeline (IndexedDB) | P2 Deferred | 1 session | Cut from R4; v2.5.1 |
| 3 | Apple Health JSON Import | P2 Deferred | ~2 hours | Cut from R4; v2.5.1 |
| 4 | Edit/Delete UI for Progress rows | P2 Deferred | ~3 hours | Cut from R4; v2.5.1 |

All v1.0, v2.0-T2 (VO2/pace/PR/ACWR), and v2.0-T3 (heatmap/measurements/badges/digest/Cmd+K/cursor) items shipped through v2.5.0 — see Changelog below.

---

## Changelog

### v2.5.0 — Apr 25, 2026 — Complete Visual Revamp ("Subtle Extravagant" editorial pass)

> **One coherent ship across four tranches (R1–R4) absorbing v2.0 Tranche 2 and Tranche 3 feature work.**
> Net delta: ~3,000 lines, 11,801 lines total. No new libs (GSAP + ScrollTrigger + Lucide UMD only).
> Direct user request: _"Using your new design skills, do a complete revamp of our training site, make it visually appealing, find inspiration from Godly and other sources. ShadCN for icons etc. Do Your magic."_

**v2.5-a — Editorial foundation polish (Tranche R1, commit `ccda58a`)**
- Unified all 8 tabs to v3 editorial language: `.card-glass` primitives, `.eyebrow` labels, `.section-kicker` framing, OKLCH accent borders.
- ~50 inline-SVG → Lucide swaps across Training/Diet/Cricket/Race-Strategy/Progress/Dharma/Travel.
- Activity-accent pill modifier classes (running/strength/HYROX/cricket/recovery).
- `sectionReveals()` extended to all new `.card-glass` wrappers via existing `__v3: true` + `data-v3-reveal` dedup pattern.
- Tab-stacking class-based visibility fix (was hotfix `v2.0-a.2`, rolled into R1 commit).

**v2.5-b — Hero wow moment + motion upgrade (Tranche R2, commit `7370850`)**
- Pinned-feel scrub hero on Dashboard (rAF-throttled scroll listener, not `ScrollTrigger.pin` — iOS Safari safe; matchMedia ≥768px gate).
- First-load-only scramble wordmark (1.2s, sessionStorage `_v25HeroScrambled` guard, motion-safe).
- Counter physics upgrade: scramble-then-settle on `.metric-value`; `dataset.v3Counted` coordination prevents v3 animateCounters race condition.
- Aurora parallax on `body::after` via `background-position` (rAF-throttled).
- Scrubbed ghost-numeral backgrounds on the 5 Dashboard metric cards.

**v2.5-c — Progress narrative rebuild + v2.0-T2 features (Tranche R3, commit `51c5ec8`)**
- VO2 max card via Jack Daniels VDOT formula, auto-computed from latest race.
- Running pace zones (Z1–Z5) derived from latest 5K/10K via Riegel scaling (exponent 1.06).
- Strength PR tracker — `AppState.strengthPRs[]`, `openModal('strength-pr')` with 8 preset lifts + custom, per-lift progressive-overload chart, `pr-fresh` gold-halo on newest PR.
- ACWR training-load card — 7-day ÷ 28-day workload ratio with color-coded zones (detrain/sweet/caution/risk).
- HYROX per-station sparklines on Delhi + Mumbai race cards.
- Canvas resize gating (`offsetParent !== null`) prevents 0-width canvas corruption when Progress tab hidden.
- Pill OKLCH contrast bumped 10% → 18% in 3 failing spots (Lighthouse A11y pass).
- 4 empty states rewritten with momentum-framing eyebrow + CTA pill (race history, strength PRs, gateway timeline, today activity).
- Editorial scroll-driven ghost numerals on weight + FBS chart panels.

**v2.5-d — Habit/motivation layer + polish (Tranche R4, commit pending)**
- **365-cell consistency heatmap** at the bottom of Progress (CSS grid, 7 rows × ~52 cols, OKLCH green ramp, today outlined). Activity score 0–4 per day from workouts + weights + bloodSugar + gatewaySessions + strengthPRs + measurements.
- **Transformation Arc card** on Progress — editorial sentence tying days-since-baseline + weight Δ + FBS Δ + sessions count, with gradient-clipped `<strong>` accents.
- **PR celebrations** — confetti host (70 OKLCH-tinted pieces, 2.6s keyframe) + toast on first encounter of a fresh PR. Dedup via `AppState.prCelebrationsSeen` celebration-key. Reduced-motion gated.
- **Milestone badges** — 10 auto-awarded badges on Dharma tab (first-workout, week-streak, month-streak, first-pr, sub-10kg, sub-pre-diabetic, race-logged, gateway-7, measure-3, day-100). Earned at full opacity + gold gradient, unearned at 32% opacity + grayscale.
- **Weekly digest** — Sunday-only Dashboard card with sessions / km / weight Δ / avg FBS / gateway count + copy-to-clipboard.
- **Body measurements** — `AppState.measurements[]`, 7-field modal (waist + 6 tape sites), waist trend chart with pre-diabetes zone bands (0–94 green, 94–102 amber, 102+ red).
- **CSV export** — single-file dump of all 10 `AppState` arrays with `#sheet,name` header per array; `kash-fitness-${today}.csv` download via Blob + URL.createObjectURL.
- **Cmd+K command palette** — global search across 8 tabs + 6 log shortcuts + 2 actions + recent 30 workouts + races. ↑↓/⏎/esc navigation, scrollIntoView, mix-blend-mode overlay.
- **Custom cursor** (desktop only, `pointer: fine` + non-reduced-motion gate) — dot + ring with `mix-blend-mode: difference`, lerp-followed ring (factor 0.18), enlarges on `.card-glass` / button / `[data-tab]` hover.
- **Grid-7 mobile fix** — horizontal scroll-snap + 56px min-width per day cell under 768px.
- Per-tab re-render orchestrator via `_v25R4Wrapped` switchTab flag + 1500ms polling tick that recomputes a cheap signature and re-renders badges + (Progress-only) Transformation Arc + Heatmap.

**Hotfixes absorbed into v2.5:**
- `v2.0-a.1` (commit `04079ec`) — hero `.hero-name > span` gradient-clip inheritance, `sectionReveals()` excluding `#panel-dashboard`, `document.fonts.ready.then(refresh)`, `immediateRender: false` belt-and-braces (now part of v2.5-a).
- `v2.0-a.2` — tab-stacking class-based visibility (now part of v2.5-a).

**Net behaviour preserved (regression-checked):**
- All 8 tabs open without console errors after each tranche.
- Existing weight / FBS / body-comp charts render identically.
- Dharma checkboxes toggle and persist.
- Travel tab Korea content intact.
- Phase bar still shows 6 segments.
- PWA install prompt fires; offline mode serves app shell.
- `prefers-reduced-motion: reduce` → no scramble, no confetti, no custom cursor, instant numerals, no heatmap hover transitions.

### v2.0-a — Apr 23, 2026 (commit `55d3aa0`) — PWA foundation + critical fixes + A11y baseline
- PWA shell: `manifest.json`, `service-worker.js`, `icon.svg`, iOS touch icons.
- `persist()` wrapper around `localStorage.setItem` — catches `QuotaExceededError`, falls back to sessionStorage, surfaces toast.
- `loadRemote()` hardening — promise-returning, `_isMerging` flag prevents mid-merge `save()` overwrites, yellow-dot on WhatsApp pill on failure.
- `escHTML(str)` / `escTrunc(str, n)` helpers replace incomplete `replace(/</g,'&lt;')`; all user-notes render paths routed through them.
- Modal hygiene: `closeModal()` on tab switch, focus restoration via `document._lastModalOpener`.
- Reduced-motion JS gates on hero char-reveal, counter, cursor glow.
- ScrollTrigger dedup via `__v3: true` tag in `sectionReveals()`.
- OG/Twitter meta tags, Apple smart-banner, canonical, `viewport-fit=cover`.
- Font diet: Inter 400/500/600/700 + Outfit 500/600/700 + JetBrains Mono 500 (~60KB saved).
- Nav scroll affordance: gradient fade + sentinel + IntersectionObserver.
- WCAG tab-pattern: roving tabindex, ArrowLeft/Right/Home/End keyboard handler.

### v1.1.0 — Apr 21, 2026
**Shipped 8 of 9 v1.0 items in two commits.**

**Data loggers (Commit A):**
- **FBS daily logger** (P1 #2) — `AppState.bloodSugar[]`, `openModal('fbs')`, dashboard metric card with zone coloring (green <100 / amber 100–125 / red ≥126), Progress tab FBS line chart with target-zone bands. Same-day dedup.
- **InBody scan upgrade** (P2 #4) — `addWeight()` extended with `{visceralFat, bmr, inBody, notes}` extras, weight modal now has BF% / SMM / VFL / BMR / inBody-checkbox inputs, body-composition dual-axis chart on Progress tab, InBody halo dots + vertical dashed markers (May 10, Jun 21, Jul 21) on weight chart. Blood Work Tracker updated to v3 baseline column.
- **Race result logger** (P3 #9) — `AppState.raceResults[]`, `openModal('race-result', raceId)`, "+ Log Result" button on every race card with `data-race-id`, status-pill swap (UPCOMING → COMPLETED · time), Race History section on Progress tab.
- **HYROX station-splits** (P2 #6) — `AppState.hyroxSessions[]`, 8-station modal + total time + notes, "+ Log Splits" button on HYROX Delhi + Mumbai cards.
- **`drawLineChart()` helper** — extracted generic canvas charting (zones, markers, y-labels, retina-aware) so new charts are ~15 lines of wrapper code each.

**Dharma content + baseline reconciliation (Commit B):**
- **Pancha Astra → Dasha Astra** (P3 #7) — appended 5 new `.quality-card` divs: Vajra, Pashupatastra, Brahmastra, Sudarshana Chakra, Trishul.
- **Gateway Audio card** (P2 #3) — Monroe YouTube sampler, Huberman NSDR, Insight Timer.
- **Gateway session logger** (P2 #5) — `AppState.gatewaySessions[]`, `openModal('gateway-session')`, Gateway Streak widget, timeline.
- **iOS Shortcuts card** (P3 #8) — 4 static recipes (Brahma Muhurta, Pre-Run Red Charge, 10 PM Wind-Down, Sunday Kurukshetra Dhyana).
- **InBody baseline card reconciled to Plan v3 PDF** — full 3-row layout with Blood Panel block.

### v1.0.0 — Apr 20, 2026
- Initial roadmap release. 9 items across P1, P2, P3.
- Vercel endpoint shape and `data.json` schema reference.
- Semantic versioning convention established.

### Parked in-session (Apr 20, 2026)
- Plan v3 restructure — 6 phases.
- Bangalore pre-race guide.
- Travel tab (Korea trip).
- Weight tracker fix.
