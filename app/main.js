import { HealthShortcut, PushReminders, Strava, Training, Whoop, deleteEntity, entitiesOf, entityRevision, pullAllChanges, pushEntity } from './services.js';
import { applyPlanAdjustments, dailyBrief, localDay, recoveryColor, todayFocus, whoopMetrics, workoutDetails } from './models.js';
import { isRetiredPractice, loadState, mergeRemoteState, saveState } from './state.js';
import { loadRemoteCache, loadSyncSnapshot, saveRemoteCache, saveSyncSnapshot } from './cache.js';

const PRIMARY_PLAN_ID = 'hyrox-current';
const AUTO_REFRESH_MS = 15 * 60_000;
const QUOTA_BACKOFF_MS = 6 * 60 * 60_000;
const QUOTA_MESSAGE = 'Cloud sync is paused because Neon’s monthly transfer allowance is used. Saved data remains available.';
const remoteCache = loadRemoteCache();

const app = {
  route: 'today',
  state: loadState(),
  snapshot: loadSyncSnapshot(),
  whoop: remoteCache.whoop || null,
  strava: remoteCache.strava || null,
  catalog: remoteCache.catalog || { plans: [], enrollments: [] },
  catalogError: null,
  online: navigator.onLine,
  refreshing: false,
  quotaBackoffUntil: Number(remoteCache.quotaBackoffUntil || 0),
  syncIssue: Number(remoteCache.quotaBackoffUntil || 0) > Date.now() ? QUOTA_MESSAGE : null,
  planWeek: null,
  expandedSession: localDay(),
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const nowISO = () => new Date().toISOString();

boot();

async function boot() {
  bindShell();
  applyRoute(routeFromLocation(), false);
  handleLaunchAction();
  handleOAuthResult();
  renderAll();
  setupMotion();
  setupPullToRefresh();
  setupSheetDrag();
  registerServiceWorker();
  await refreshAll({ quiet: true });
}

function handleOAuthResult() {
  const parameters = new URLSearchParams(location.search);
  const result = parameters.get('whoop');
  if (!result) return;
  const reason = parameters.get('reason') || '';
  const messages = {
    whoop_access_denied: 'WHOOP access was not approved.',
    whoop_invalid_scope: 'WHOOP rejected a requested permission. Check the app scopes in the WHOOP developer dashboard.',
    invalid_oauth_state: 'The WHOOP connection expired. Please tap Connect and try again.',
    missing_authorization_code: 'WHOOP did not return an authorization code. Please try connecting again.',
    whoop_offline_scope_not_granted: 'WHOOP did not grant background refresh access. Enable the offline scope and reconnect.',
    provider_invalid_client: 'WHOOP rejected this app’s client credentials. Check the Vercel client ID and secret.',
    provider_invalid_grant: 'WHOOP rejected the authorization code. Please reconnect from Settings.',
    provider_invalid_redirect_uri: 'WHOOP rejected the callback URL. Register the exact Kash OS callback in the developer dashboard.',
    server_not_configured: 'The WHOOP connection is not fully configured on Vercel.',
    profile_fetch_failed: 'WHOOP connected, but the first profile sync failed. Please reconnect.',
  };
  const message = result === 'connected'
    ? 'WHOOP connected. Importing recovery, sleep and workouts…'
    : messages[reason] || `WHOOP connection failed${reason ? ` · ${reason.replaceAll('_', ' ')}` : ''}.`;
  setTimeout(() => toast(message), 120);
  history.replaceState(null, '', `${location.pathname}${location.hash || ''}`);
}

function handleLaunchAction() {
  const fragment = location.hash.includes('?') ? location.hash.split('?')[1] : '';
  const action = new URLSearchParams(fragment).get('action');
  if (action === 'log-measurement') setTimeout(() => openLogForm('measurement'), 80);
  if (action === 'log-glucose') setTimeout(() => openLogForm('glucose'), 80);
  if (['settings', 'connect'].includes(routeFromLocation())) setTimeout(() => openSettings(), 80);
}

function bindShell() {
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#sheet-layer').hidden) closeSheet(); });
  window.addEventListener('hashchange', () => applyRoute(routeFromLocation(), false));
  window.addEventListener('online', () => { app.online = true; updateConnectivity(); if (shouldAutoRefresh()) refreshAll({ quiet: true }); });
  window.addEventListener('offline', () => { app.online = false; updateConnectivity(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.online && shouldAutoRefresh()) refreshAll({ quiet: true });
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && app.online) refreshAll({ quiet: true });
  }, AUTO_REFRESH_MS);
  $('#library-search')?.addEventListener('input', event => renderLibrary(event.target.value));
  updateConnectivity();
}

async function refreshAll({ quiet = false, force = false } = {}) {
  if (app.refreshing) return;
  const indicator = $('#pull-indicator');
  if (!force && Date.now() < app.quotaBackoffUntil) {
    app.syncIssue = QUOTA_MESSAGE;
    $('#sync-dot').dataset.state = 'error';
    indicator.textContent = 'Cloud sync paused · saved data shown';
    indicator.classList.add('is-visible');
    setTimeout(() => indicator.classList.remove('is-visible'), 1600);
    if (!quiet) toast(QUOTA_MESSAGE);
    return;
  }
  app.refreshing = true;
  indicator.textContent = 'Refreshing health signals…';
  indicator.classList.add('is-visible');
  $('#sync-dot').dataset.state = 'loading';
  const [snapshotResult, whoopResult, catalogResult, stravaResult] = await Promise.allSettled([
    pullAllChanges(app.snapshot), Whoop.status(), Training.catalog(false), Strava.status(),
  ]);
  if (snapshotResult.status === 'fulfilled') {
    app.snapshot = snapshotResult.value;
    saveSyncSnapshot(app.snapshot);
    app.state = mergeRemoteState(app.state, app.snapshot.entities);
    await retireRemovedPractices();
    saveState(app.state);
  }
  if (whoopResult.status === 'fulfilled') app.whoop = whoopResult.value;
  if (catalogResult.status === 'fulfilled') {
    app.catalog = {
      plans: (catalogResult.value.plans || []).filter(plan => plan.id === PRIMARY_PLAN_ID),
      enrollments: (catalogResult.value.enrollments || []).filter(enrollment => enrollment.planID === PRIMARY_PLAN_ID),
    };
    app.catalogError = app.catalog.plans.length ? null : 'HYROX plan unavailable';
  }
  else app.catalogError = catalogResult.reason?.message || 'Training catalog unavailable';
  if (stravaResult.status === 'fulfilled') app.strava = stravaResult.value;
  if ([snapshotResult, whoopResult, catalogResult, stravaResult].some(result => result.status === 'fulfilled')) app.state.lastRefreshAt = nowISO();
  saveState(app.state);
  const failed = [snapshotResult, whoopResult, catalogResult, stravaResult].filter(result => result.status === 'rejected');
  const quotaFailure = failed.find(result => result.reason?.code === 'database_quota_exceeded');
  if (quotaFailure) {
    app.quotaBackoffUntil = Date.now() + QUOTA_BACKOFF_MS;
    app.syncIssue = QUOTA_MESSAGE;
    if (app.catalog.plans?.length) app.catalogError = null;
  } else if (!failed.length) {
    app.quotaBackoffUntil = 0;
    app.syncIssue = null;
  }
  persistRemoteState();
  $('#sync-dot').dataset.state = failed.length ? 'error' : 'online';
  renderAll();
  app.refreshing = false;
  indicator.textContent = quotaFailure ? 'Cloud sync paused · saved data shown' : failed.length ? 'Some sources could not refresh' : 'Up to date';
  setTimeout(() => indicator.classList.remove('is-visible'), 850);
  if (quotaFailure) toast(QUOTA_MESSAGE);
  else if (!quiet && failed.length) toast('Some sources are unavailable. Cached data is still shown.');
}

function shouldAutoRefresh() {
  const lastRefresh = new Date(app.state.lastRefreshAt || 0).getTime();
  return !Number.isFinite(lastRefresh) || Date.now() - lastRefresh >= AUTO_REFRESH_MS;
}

function persistRemoteState() {
  saveRemoteCache({
    whoop: app.whoop,
    strava: app.strava,
    catalog: app.catalog,
    quotaBackoffUntil: app.quotaBackoffUntil,
    cachedAt: nowISO(),
  });
}

async function retireRemovedPractices() {
  const retired = entitiesOf(app.snapshot, 'practice_template').filter(entity => isRetiredPractice({ ...entity.data, id: entity.id }));
  if (!retired.length) return;
  const results = await Promise.allSettled(retired.map(entity => deleteEntity('practice_template', entity.id, entity.revision)));
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const entity = retired[index];
    app.snapshot.entities.delete(`practice_template:${entity.id}`);
    app.snapshot.revisions.set(`practice_template:${entity.id}`, Number(result.value?.results?.[0]?.revision || entity.revision + 1));
  });
}

function renderAll() {
  renderToday();
  renderTrain();
  renderProgress();
  renderLibrary($('#library-search')?.value || '');
  requestAnimationFrame(() => {
    setupMotion();
    const ring = $('.metric-ring');
    if (ring) requestAnimationFrame(() => ring.classList.add('is-ready'));
  });
}

function renderToday() {
  const target = $('#today-content');
  if (!target) return;
  const metrics = whoopMetrics(app.whoop || {});
  const session = todaySessions()[0] || null;
  const brief = dailyBrief(metrics, session);
  const recovery = metrics.recovery;
  const score = recovery.value;
  const circumference = 603;
  const offset = score == null ? circumference : circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const today = localDay();
  const activePractices = app.state.practices.filter(item => item.active !== false).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const completed = new Set(app.state.practiceCompletions.filter(item => item.day === today && item.completed).map(item => item.practiceID));
  const sessionCompleted = Boolean(session && entitiesOf(app.snapshot, 'plan_completion').some(item => item.data.sessionID === session.id && item.data.completed !== false));
  const focus = todayFocus({ session, sessionCompleted, practices: activePractices, completedPracticeIDs: [...completed] });
  const measurements = sorted(app.state.measurements, item => item.timestamp || item.date);
  const latestMeasurement = measurements[0];
  const weight = number(latestMeasurement?.weightKilograms ?? latestMeasurement?.weight ?? latestMeasurement?.kg);
  const glucose = number(sorted(app.state.bloodSugar, item => item.timestamp || item.date)[0]?.value ?? sorted(app.state.bloodSugar, item => item.timestamp || item.date)[0]?.mgDl);
  const refreshTime = app.whoop?.lastSyncedAt || app.state.lastRefreshAt;

  target.classList.remove('skeleton-screen');
  target.innerHTML = `
    <header class="today-intro" data-reveal><p class="eyebrow">${escapeHTML(new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase())}</p><h2>${escapeHTML(greeting())},<br>Kash.</h2></header>
    <article class="card focus-card" aria-labelledby="today-focus-title">
      <div class="focus-head"><p class="card-kicker">NEXT UP</p><span>${focus.total ? `${focus.done} of ${focus.total} essentials` : 'Open day'}</span></div>
      <h3 id="today-focus-title">${escapeHTML(focus.title)}</h3>
      <p>${escapeHTML(focus.body)}</p>
      <div class="focus-progress" role="progressbar" aria-label="Today’s essentials" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${focus.progress}"><i style="--progress:${focus.progress}%"></i></div>
      <button class="primary-button focus-action" type="button" data-action="${focus.kind === 'session' ? 'focus-session' : focus.kind === 'practice' ? 'focus-practice' : 'open-log'}"${focus.targetID ? ` data-practice-id="${escapeHTML(focus.targetID)}"` : ''}>${escapeHTML(focus.actionLabel)}</button>
    </article>
    <section class="whoop-glass card" aria-label="WHOOP recovery" data-reveal>
      <div class="whoop-head"><div><p class="card-kicker">WHOOP · PROCESSED SYNC</p><h3>Daily recovery</h3></div><span class="freshness">${escapeHTML(relativeTime(refreshTime))}</span></div>
      <div class="whoop-layout">
        <div class="ring-stage compact-ring"><svg class="metric-ring" viewBox="0 0 224 224" style="--ring-color:${recoveryColor(score)};--ring-offset:${offset}"><circle class="track" cx="112" cy="112" r="96"></circle><circle class="value" cx="112" cy="112" r="96"></circle></svg><div class="ring-copy"><div>${score == null ? '<span class="metric-number unavailable">—</span>' : `<span class="metric-number">${Math.round(score)}</span><span class="metric-unit">%</span>`}</div><div class="metric-label">Recovery</div></div></div>
        <div class="whoop-stats"><div class="inset-stat"><strong>${metricValue(metrics.sleep, 0)}</strong><span>Sleep</span></div><div class="inset-stat"><strong>${metricValue(metrics.strain, 1)}</strong><span>Strain</span></div><div class="inset-stat"><strong>${metricValue(metrics.hrv, 0)}</strong><span>HRV ms</span></div><div class="inset-stat"><strong>${metricValue(metrics.rhr, 0)}</strong><span>RHR bpm</span></div></div>
      </div>
    </section>
    <article class="card brief-card ${brief.level === 'unavailable' ? 'is-quiet' : ''}" data-reveal>
      <p class="card-kicker">TODAY'S READ · ${escapeHTML(brief.level)}</p><h3>${escapeHTML(brief.title)}</h3><p>${escapeHTML(brief.body)}</p><div class="brief-rule">${escapeHTML(brief.rule)}</div>
    </article>
    <div class="section-heading" id="today-session-heading"><h3>Today’s training</h3><button type="button" data-route="train">View plan</button></div>
    <div id="today-session">${session ? sessionCard(session, { open: true, today: true }) : `<article class="card empty-state" data-reveal><strong>No scheduled session found</strong>Your active catalog has no session mapped to ${today}. Recovery advice remains available.</article>`}</div>
    <div class="section-heading"><h3>Daily Dharma</h3><button type="button" data-action="edit-practices">Edit</button></div>
    <article class="card" id="daily-practices" data-reveal><div class="practice-list">${activePractices.map(practice => {
      const isDone = completed.has(practice.id);
      return `<div class="practice-item ${isDone ? 'is-complete' : ''}"><button class="practice-check" type="button" data-action="toggle-practice" data-practice-id="${escapeHTML(practice.id)}" aria-label="${isDone ? 'Uncheck' : 'Complete'} ${escapeHTML(practice.title)}">${isDone ? '✓' : ''}</button><div><div class="practice-name">${escapeHTML(practice.title)}</div><div class="practice-time">${Number(practice.minutes || 0)} min · ${isDone ? 'complete today' : 'ready when you are'}</div></div><span class="source-mark">${isDone ? 'DONE' : 'OPEN'}</span></div>`;
    }).join('')}</div></article>
    <div class="section-heading"><h3>Quick log</h3><span>One tap away</span></div>
    <div class="quick-grid" data-reveal>
      ${quickAction('measurement', '↕', 'Body')}${quickAction('glucose', '⌁', 'Glucose')}${quickAction('meal', '◌', 'Meal')}${quickAction('journal', '✦', 'Journal')}
    </div>
    <div class="section-heading"><h3>Latest body signal</h3><button type="button" data-route="progress">History</button></div>
    <article class="card list-row" data-reveal><div><h3>${weight == null ? 'No body measurement yet' : `${weight.toFixed(1)} kg`}</h3><p>${latestMeasurement ? `${formatDate(latestMeasurement.timestamp || latestMeasurement.date)} · ${escapeHTML(latestMeasurement.source || 'Kash OS')}` : 'Log it here or import it with the Health Shortcut.'}</p></div><div class="value-pair"><strong>${glucose == null ? '—' : Math.round(glucose)}</strong><span>mg/dL</span></div></article>
  `;
}

function renderTrain() {
  const target = $('#train-content');
  if (!target) return;
  const allSessions = allScheduledSessions();
  const weekMap = new Map();
  allSessions.forEach(session => {
    const key = `${session.planID}:${session.weekTitle || 'Schedule'}`;
    if (!weekMap.has(key)) weekMap.set(key, { key, title: session.weekTitle || 'Schedule', sessions: [] });
    weekMap.get(key).sessions.push(session);
  });
  const weeks = [...weekMap.values()];
  const today = localDay();
  const currentWeek = weeks.find(week => week.sessions.some(session => session.scheduledDate === today)) || weeks.find(week => week.sessions.some(session => session.scheduledDate >= today)) || weeks.at(-1);
  if (!app.planWeek || !weekMap.has(app.planWeek)) app.planWeek = currentWeek?.key || weeks[0]?.key || null;
  if (app.expandedSession === today) app.expandedSession = allSessions.find(session => session.scheduledDate === today)?.id || null;
  const selectedWeek = weekMap.get(app.planWeek) || currentWeek;
  const sessions = selectedWeek?.sessions || [];
  const days = daysToRace();
  const sessionIDs = new Set(allSessions.map(session => session.id));
  const completions = entitiesOf(app.snapshot, 'plan_completion').filter(item => item.data.planID === PRIMARY_PLAN_ID && item.data.completed !== false && sessionIDs.has(item.data.sessionID));
  $('#train-countdown').textContent = days ? `${days} days` : 'Race day';
  target.innerHTML = `
    <article class="training-summary card" data-reveal><div><p class="card-kicker">CURRENT BLOCK</p><strong>${days}</strong><span>days to HYROX Mumbai</span></div><div><p class="card-kicker">PROGRESS</p><strong>${completions.length}<small> / ${allSessions.length}</small></strong><span>sessions complete</span></div><div class="plan-progress"><div><i style="--progress:${Math.min(100, allSessions.length ? completions.length / allSessions.length * 100 : 0)}%"></i></div></div></article>
    <div class="week-scroller" aria-label="Training weeks">${weeks.map((week, index) => `<button class="week-chip ${week.key === app.planWeek ? 'is-active' : ''}" type="button" data-action="select-plan-week" data-week-key="${escapeHTML(week.key)}"><span>W${index + 1}</span>${escapeHTML(week.title.replace(/^Week\s*\d+\s*[·.-]?\s*/i, ''))}</button>`).join('')}</div>
    ${selectedWeek ? `<article class="week-focus glass-flat" data-reveal><p class="card-kicker">${escapeHTML(selectedWeek.title)}</p><strong>${escapeHTML(formatDate(selectedWeek.sessions[0]?.scheduledDate))} → ${escapeHTML(formatDate(selectedWeek.sessions.at(-1)?.scheduledDate))}</strong><span>${selectedWeek.sessions.length} planned sessions · tap any card for full details</span></article>` : ''}
    <div class="activity-list detailed-plan">${sessions.length ? sessions.map(session => sessionCard(session, { open: app.expandedSession === session.id })).join('') : `<article class="card empty-state"><strong>${escapeHTML(app.catalogError || 'No HYROX sessions available')}</strong>The single active training block could not be loaded.<div style="margin-top:14px"><button class="secondary-button" type="button" data-action="refresh-app">Try again</button></div></article>`}</div>
  `;
}

function renderProgress() {
  const target = $('#progress-content');
  if (!target) return;
  const metrics = whoopMetrics(app.whoop || {});
  const measurements = sorted(app.state.measurements, item => item.timestamp || item.date);
  const weights = measurements.map(item => number(item.weightKilograms ?? item.weight ?? item.kg)).filter(value => value != null).slice(0, 12).reverse();
  const activities = sorted(app.state.workouts, item => item.startedAt || item.date).slice(0, 12);
  const glucose = sorted(app.state.bloodSugar, item => item.timestamp || item.date).slice(0, 8);
  const max = Math.max(...weights, 1); const min = Math.min(...weights, max);
  target.innerHTML = `
    <article class="pulse-hero card" data-reveal><div class="pulse-score" style="--pulse-color:${recoveryColor(metrics.recovery.value)}"><strong>${metricValue(metrics.recovery, 0)}</strong><span>Recovery</span></div><div class="pulse-copy"><p class="card-kicker">WHOOP · ${escapeHTML(relativeTime(app.whoop?.lastSyncedAt))}</p><h3>Your readiness signals</h3><div class="pulse-grid"><span><b>${metricValue(metrics.hrv, 0)}</b>HRV ms</span><span><b>${metricValue(metrics.rhr, 0)}</b>RHR</span><span><b>${metricValue(metrics.sleep, 0)}</b>Sleep</span><span><b>${metricValue(metrics.strain, 1)}</b>Strain</span></div></div></article>
    <article class="card chart-card" data-reveal><p class="card-kicker">BODY WEIGHT · LAST ${weights.length || 0}</p><div class="chart">${weights.length ? weights.map(value => `<span class="chart-bar" style="--bar:${25 + ((value - min) / Math.max(1, max - min)) * 70}%" title="${value.toFixed(1)} kg"></span>`).join('') : '<div class="chart-empty">Log weight to start the trend.</div>'}</div></article>
    <div class="section-heading"><h3>Measurements</h3><span>${measurements.length} records</span></div>
    <div class="measurement-list">${measurements.length ? measurements.slice(0, 8).map(item => measurementRow(item)).join('') : emptyRow('No measurements', 'Add a body reading or run the Health Shortcut.')}</div>
    <div class="section-heading"><h3>Blood glucose</h3><span>Not medical advice</span></div>
    <div class="measurement-list">${glucose.length ? glucose.map(item => `<article class="list-row" data-reveal><div><h3>${escapeHTML(item.context || item.type || 'Blood glucose')}</h3><p>${formatDate(item.timestamp || item.date)} · ${escapeHTML(item.source || 'Kash OS')}</p></div><div class="value-pair"><strong>${Math.round(number(item.value ?? item.mgDl) || 0)}</strong><span>mg/dL</span></div></article>`).join('') : emptyRow('No glucose entries', 'Use Quick Log to add a reading.')}</div>
    <div class="section-heading"><h3>Activity history</h3><span>WHOOP + Strava</span></div>
    <div class="activity-list">${activities.length ? activities.map(item => activityRow(item)).join('') : emptyRow('No imported activity', 'Connect WHOOP or Strava in Settings.')}</div>
  `;
}

function renderLibrary(query = '') {
  const target = $('#library-content');
  if (!target) return;
  const groups = [
    { id: 'diet', title: 'Nutrition & diet', meta: 'Fueling, supplements, glucose and meal frameworks', body: 'Your existing nutrition plan, race fueling, supplement notes and meal references remain available here.', href: '/legacy.html#panel-diet' },
    { id: 'cricket', title: 'Cricket & fast bowling', meta: 'Bowling modules, drills and biomechanics', body: 'T20 Strike modules, fast-bowling drills, biomechanics and pace research.', href: '/legacy.html#panel-cricket' },
    { id: 'race', title: 'Race strategy', meta: 'Pacing, splits, checklists and post-mortems', body: 'TCS 10K history, pacing protocols and current HYROX race strategy.', href: '/legacy.html#panel-race-strategy' },
    { id: 'travel', title: 'Travel protocols', meta: 'Training continuity, packing and recovery', body: 'Travel plans and routines are archived as references instead of daily navigation.', href: '/legacy.html#panel-travel' },
    { id: 'dharma', title: 'Dharma source library', meta: 'Long-form practices and Gita material', body: 'The complete original Dharma material remains here; Today uses only your editable micro-practices.', href: '/legacy.html#panel-dharma' },
    { id: 'reports', title: 'Legacy reports & analytics', meta: 'Deep tables and historical dashboards', body: 'Open the previous detailed progress surface when you need the full historical tables.', href: '/legacy.html#panel-progress' },
  ].filter(item => `${item.title} ${item.meta} ${item.body}`.toLowerCase().includes(query.trim().toLowerCase()));
  target.innerHTML = groups.length ? `<div class="library-list">${groups.map((item, index) => `<details class="library-group" data-reveal><summary><div class="library-index">${String(index + 1).padStart(2, '0')}</div><div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.meta)}</p></div><span>＋</span></summary><div class="library-body">${escapeHTML(item.body)}<br><a href="${item.href}">Open reference archive →</a></div></details>`).join('')}</div>` : '<div class="empty-state"><strong>No matching reference</strong>Try a broader search.</div>';
}

function handleClick(event) {
  const routeButton = event.target.closest('[data-route]');
  if (routeButton) { applyRoute(routeButton.dataset.route); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) {
    const open = event.target.closest('[data-open]')?.dataset.open;
    if (open === 'settings') openSettings();
    return;
  }
  if (action === 'close-sheet') closeSheet();
  if (action === 'open-log') openLogPicker(event.target.closest('[data-log-kind]')?.dataset.logKind);
  if (action === 'choose-log') openLogForm(event.target.closest('[data-log-kind]').dataset.logKind);
  if (action === 'toggle-practice') togglePractice(event.target.closest('[data-practice-id]').dataset.practiceId);
  if (action === 'focus-session') focusTodayTarget($('#today-session')?.querySelector('button'));
  if (action === 'focus-practice') focusTodayTarget($$('.practice-check').find(button => button.dataset.practiceId === event.target.closest('[data-practice-id]')?.dataset.practiceId));
  if (action === 'edit-practices') openPracticeEditor();
  if (action === 'select-plan-week') { app.planWeek = event.target.closest('[data-week-key]').dataset.weekKey; app.expandedSession = null; renderTrain(); setupMotion(); }
  if (action === 'toggle-session-details') { const id = event.target.closest('[data-session-id]').dataset.sessionId; app.expandedSession = app.expandedSession === id ? null : id; app.route === 'today' ? renderToday() : renderTrain(); setupMotion(); }
  if (action === 'complete-session') completeSession(event.target.closest('[data-session-id]'));
  if (action === 'whoop-connect') location.assign(Whoop.connectURL);
  if (action === 'whoop-sync') syncWhoop();
  if (action === 'whoop-disconnect') disconnectWhoop();
  if (action === 'strava-connect') location.assign(Strava.connectURL);
  if (action === 'strava-disconnect') disconnectStrava();
  if (action === 'health-write') writeLatestToHealth();
  if (action === 'enable-notifications') enableNotifications();
  if (action === 'export-data') exportData();
  if (action === 'refresh-app') refreshAll({ force: true });
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'log-form') await saveLog(new FormData(form));
  if (form.id === 'practice-form') await savePractices(new FormData(form));
}

function applyRoute(route, updateHash = true) {
  const aliases = { dashboard: 'today', training: 'train', plan: 'train', pulse: 'progress', life: 'library', diet: 'library', cricket: 'library', 'race-strategy': 'library', race: 'library', dharma: 'today', travel: 'library', settings: 'today', connect: 'today' };
  const valid = ['today', 'train', 'progress', 'library'];
  app.route = valid.includes(aliases[route] || route) ? (aliases[route] || route) : 'today';
  const headerLabels = { today: 'PERSONAL HEALTH OS', train: 'HYROX TRAINING', progress: 'HEALTH TRENDS', library: 'REFERENCE' };
  $('#today-label').textContent = headerLabels[app.route];
  const updateScreen = () => {
    $$('.screen').forEach(screen => { const active = screen.dataset.screen === app.route; screen.hidden = !active; screen.classList.toggle('is-active', active); });
    $$('.nav-item').forEach(item => { const active = item.dataset.route === app.route; item.classList.toggle('is-active', active); active ? item.setAttribute('aria-current', 'page') : item.removeAttribute('aria-current'); });
  };
  if (updateHash && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(updateScreen);
  else updateScreen();
  if (updateHash) history.pushState({}, '', `#/${app.route}`);
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  setupMotion();
}

function routeFromLocation() {
  const hash = location.hash.replace(/^#\/?(?:panel-)?/, '').split('?')[0];
  return hash || 'today';
}

function todaySessions() { return sessionsForDay(localDay()); }
function sessionsForDay(day) { return allScheduledSessions().filter(item => item.scheduledDate === day); }
function allScheduledSessions() {
  const active = new Map((app.catalog.enrollments || []).filter(item => item.active).map(item => [item.planID, item]));
  const result = [];
  for (const plan of app.catalog.plans || []) {
    if (plan.id !== PRIMARY_PLAN_ID) continue;
    const enrollment = active.get(plan.id) || { planID: plan.id, active: true, startDate: plan.fixedStartDate || null };
    const start = new Date(enrollment.startDate || plan.fixedStartDate || new Date());
    start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
    for (const week of plan.weeks || []) for (const session of week.sessions || []) {
      const scheduled = session.scheduledDate || session.date || dateWithOffset(start, Number(session.dayOffset ?? ((Number(week.index || 1) - 1) * 7)));
      result.push({ ...session, planID: plan.id, planTitle: plan.title, weekTitle: week.title, scheduledDate: String(scheduled).slice(0,10) });
    }
  }
  const adjustments = entitiesOf(app.snapshot, 'plan_adjustment').map(entity => entity.data);
  return applyPlanAdjustments(result, adjustments).sort((a,b) => a.scheduledDate.localeCompare(b.scheduledDate));
}

function sessionCard(session, options = {}) {
  if (typeof options === 'boolean') options = { compact: options };
  const completionID = `${session.planID}:${session.id}:${session.scheduledDate}`;
  const complete = entitiesOf(app.snapshot, 'plan_completion').some(item => item.data.sessionID === session.id && item.data.completed !== false);
  const distance = number(session.distanceMeters); const duration = number(session.durationSeconds);
  const moved = session.originalScheduledDate && session.originalScheduledDate !== session.scheduledDate;
  const open = options.open === true;
  const details = workoutDetails(session);
  const day = new Date(`${session.scheduledDate}T12:00:00`);
  const kind = modalityMeta(session.modality, session.intensity);
  return `<article class="card session-card detailed-session ${open ? 'is-open' : ''} ${complete ? 'is-complete' : ''}" style="--session-color:${kind.color}" data-reveal>
    <button class="session-toggle" type="button" data-action="toggle-session-details" data-session-id="${escapeHTML(session.id)}" aria-expanded="${open}">
      <span class="date-tile"><small>${escapeHTML(day.toLocaleDateString([], { weekday: 'short' }).toUpperCase())}</small><b>${day.getDate()}</b></span>
      <span class="session-summary"><span class="card-kicker">${escapeHTML(kind.icon)} ${escapeHTML(String(session.modality || 'training').toUpperCase())}${options.today ? ' · TODAY' : ''}</span><strong>${escapeHTML(session.title || 'Planned session')}</strong><span>${escapeHTML(session.planTitle || session.weekTitle || 'Training plan')}</span></span>
      <span class="session-chevron">⌄</span>
    </button>
    <div class="session-details" ${open ? '' : 'hidden'}>
      <div class="session-meta">${distance ? `<span class="mini-chip">${(distance/1000).toFixed(1)} km</span>` : ''}${duration ? `<span class="mini-chip">${Math.round(duration/60)} min</span>` : ''}${session.intensity ? `<span class="mini-chip">${escapeHTML(session.intensity)}</span>` : ''}${moved ? '<span class="mini-chip genesis-chip">GENESIS MOVE</span>' : ''}${complete ? '<span class="mini-chip done-chip">DONE ✓</span>' : ''}</div>
      ${moved ? `<div class="coach-note"><b>Genesis adjusted this session</b><span>Moved from ${escapeHTML(formatDate(session.originalScheduledDate))}${session.planAdjustment?.reason ? ` · ${escapeHTML(session.planAdjustment.reason)}` : ''}</span></div>` : ''}
      <ol class="workout-detail-list">${details.map((detail, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHTML(detail.name)}</strong>${detail.target ? `<p>${escapeHTML(detail.target)}</p>` : ''}</div></li>`).join('')}</ol>
      ${session.instructions && !session.segments?.length ? `<p class="session-instructions">${escapeHTML(session.instructions)}</p>` : ''}
      <div class="button-row"><button class="${complete ? 'secondary-button' : 'primary-button'}" type="button" data-action="complete-session" data-session-id="${escapeHTML(session.id)}" data-plan-id="${escapeHTML(session.planID)}" data-date="${escapeHTML(session.scheduledDate)}" data-completion-id="${escapeHTML(completionID)}" ${complete ? 'disabled' : ''}>${complete ? 'Completed' : 'Mark complete'}</button>${options.today ? '<button class="secondary-button" type="button" data-route="train">Full plan</button>' : ''}</div>
    </div>
  </article>`;
}

function modalityMeta(modality = '', intensity = '') {
  const key = `${modality} ${intensity}`.toLowerCase();
  if (key.includes('race')) return { color: '#d8ff3e', icon: '🏁' };
  if (key.includes('rest')) return { color: '#8a93a6', icon: '◐' };
  if (key.includes('run')) return { color: '#7df0a7', icon: '↗' };
  if (key.includes('strength')) return { color: '#ffb26b', icon: '◆' };
  if (key.includes('mobility')) return { color: '#6be8d8', icon: '◌' };
  return { color: '#ff5c7a', icon: '⚡' };
}

function measurementRow(item) {
  const weight = number(item.weightKilograms ?? item.weight ?? item.kg);
  const waist = number(item.waistCentimeters ?? item.waist);
  return `<article class="list-row" data-reveal><div><h3>${formatDate(item.timestamp || item.date)}</h3><p>${escapeHTML(item.source || 'Kash OS')} · ${escapeHTML(item.notes || (waist ? `Waist ${waist} cm` : 'Body measurement'))}</p></div><div class="value-pair"><strong>${weight == null ? '—' : weight.toFixed(1)}</strong><span>kg</span></div></article>`;
}

function activityRow(item) {
  const duration = number(item.movingSeconds ?? (item.duration ? item.duration * 60 : null));
  return `<article class="list-row" data-reveal><div><h3>${escapeHTML(item.title || item.name || 'Workout')}</h3><p>${formatDate(item.startedAt || item.date)} · ${escapeHTML(item.source || item.modality || item.type || 'Kash OS')}</p></div><div class="value-pair"><strong>${duration ? Math.round(duration/60) : '—'}</strong><span>minutes</span></div></article>`;
}

function openLogPicker(kind) {
  if (kind) { openLogForm(kind); return; }
  openSheet(`<div class="sheet-head"><div><h2>Quick log</h2><p>Add a health signal without leaving today.</p></div></div><div class="log-kind-grid">${[
    ['measurement','↕','Body measurement'],['glucose','⌁','Blood glucose'],['meal','◌','Meal'],['workout','↗','Workout'],['journal','✦','Journal'],['injury','!','Injury / symptom']
  ].map(([id, icon, label]) => `<button class="log-kind" type="button" data-action="choose-log" data-log-kind="${id}"><span>${icon}</span>${label}</button>`).join('')}</div>`);
}

function openLogForm(kind) {
  const date = new Date().toISOString().slice(0,16);
  const fields = {
    measurement: [['weightKilograms','Weight','number','kg'],['bodyFatPercentage','Body fat','number','%'],['leanMassKilograms','Lean mass','number','kg'],['bmi','BMI','number',''],['waistCentimeters','Waist','number','cm'],['chestCentimeters','Chest','number','cm'],['hipCentimeters','Hip','number','cm'],['thighCentimeters','Thigh','number','cm'],['armCentimeters','Arm','number','cm'],['calfCentimeters','Calf','number','cm'],['neckCentimeters','Neck','number','cm']],
    glucose: [['value','Reading','number','mg/dL'],['context','Context','text','fasting / post-meal']],
    meal: [['title','Meal','text',''],['calories','Calories','number','kcal'],['proteinGrams','Protein','number','g']],
    workout: [['title','Workout','text',''],['modality','Modality','text','run / strength / hyrox'],['movingMinutes','Duration','number','min'],['distanceKilometers','Distance','number','km']],
    journal: [['title','Title','text',''],['mood','Mood / energy','number','1–10']],
    injury: [['area','Area','text',''],['severity','Severity','number','1–10']],
  }[kind] || [];
  const name = ({ measurement:'Body measurement', glucose:'Blood glucose', meal:'Meal', workout:'Workout', journal:'Journal', injury:'Injury / symptom' })[kind];
  openSheet(`<div class="sheet-head"><div><h2>${name}</h2><p>Saved to Kash OS and encrypted sync.</p></div></div><form id="log-form"><input type="hidden" name="kind" value="${kind}"><div class="form-grid"><div class="field full"><label for="log-time">Date and time</label><input id="log-time" name="timestamp" type="datetime-local" value="${date}" required></div>${fields.map(([key,label,type,unit]) => `<div class="field"><label for="f-${key}">${label}${unit ? ` · ${unit}` : ''}</label><input id="f-${key}" name="${key}" type="${type}" ${type==='number' ? 'step="any" inputmode="decimal"' : ''}></div>`).join('')}<div class="field full"><label for="log-notes">Notes</label><textarea id="log-notes" name="notes"></textarea></div></div><div class="form-actions"><button class="secondary-button" type="button" data-action="close-sheet">Cancel</button><button class="primary-button" type="submit">Save</button></div></form>`);
}

async function saveLog(form) {
  const kind = form.get('kind');
  const timestamp = new Date(form.get('timestamp')).toISOString();
  const id = crypto.randomUUID();
  const value = { id, timestamp, date: timestamp.slice(0,10), source: 'Kash OS', provenance: 'userEntered' };
  for (const [key, raw] of form.entries()) {
    if (['kind','timestamp'].includes(key) || raw === '') continue;
    value[key] = ['notes','title','context','modality','area'].includes(key) ? raw : Number(raw);
  }
  let entityKind = kind;
  let stateKey = kind;
  if (kind === 'measurement') { entityKind = 'body_measurement'; stateKey = 'measurements'; }
  if (kind === 'glucose') { entityKind = 'bloodSugar'; stateKey = 'bloodSugar'; }
  if (kind === 'meal') { entityKind = 'meals'; stateKey = 'meals'; }
  if (kind === 'workout') { entityKind = 'workout'; stateKey = 'workouts'; value.startedAt = timestamp; value.movingSeconds = number(value.movingMinutes) ? value.movingMinutes * 60 : null; value.distanceMeters = number(value.distanceKilometers) ? value.distanceKilometers * 1000 : null; }
  if (kind === 'injury') { entityKind = 'injuries'; stateKey = 'injuries'; }
  app.state[stateKey] = [value, ...(app.state[stateKey] || [])];
  saveState(app.state); closeSheet(); renderAll(); toast(`${({measurement:'Measurement',glucose:'Glucose',meal:'Meal',workout:'Workout',journal:'Journal',injury:'Injury'})[kind]} saved`);
  try { await pushEntity(entityKind, id, value, 0, 'userEntered'); await refreshAll({ quiet: true, force: true }); }
  catch { toast('Saved on this phone. Cloud sync will retry when available.'); }
}

async function togglePractice(practiceID) {
  const day = localDay(); const id = `${practiceID}:${day}`;
  const index = app.state.practiceCompletions.findIndex(item => item.id === id);
  const completed = index < 0 ? true : !app.state.practiceCompletions[index].completed;
  const record = { id, practiceID, day, completed, timestamp: nowISO(), source: 'Kash OS' };
  if (index < 0) app.state.practiceCompletions.push(record); else app.state.practiceCompletions[index] = record;
  const practice = app.state.practices.find(item => item.id === practiceID);
  saveState(app.state); renderToday(); setupMotion();
  toast(`${practice?.title || 'Practice'} ${completed ? 'complete' : 'reopened'}`);
  try { await pushEntity('practice_completion', id, record, entityRevision(app.snapshot, 'practice_completion', id), 'userEntered'); }
  catch { toast('Practice saved on this phone; sync is offline.'); }
}

function openPracticeEditor() {
  openSheet(`<div class="sheet-head"><div><h2>Daily Dharma</h2><p>Keep up to five practices small enough to repeat.</p></div></div><form id="practice-form"><div class="form-grid">${app.state.practices.map((practice,index) => `<div class="field full"><label>Practice ${index+1}</label><input name="title-${index}" value="${escapeHTML(practice.title)}" required></div><div class="field"><label>Minutes</label><input name="minutes-${index}" type="number" min="1" max="60" value="${Number(practice.minutes || 5)}"></div><input type="hidden" name="id-${index}" value="${escapeHTML(practice.id)}">`).join('')}<div class="field full"><label>Add another (optional)</label><input name="new-title" placeholder="Short daily practice"></div></div><div class="form-actions"><button class="secondary-button" type="button" data-action="close-sheet">Cancel</button><button class="primary-button" type="submit">Save practices</button></div></form>`);
}

async function savePractices(form) {
  const previous = [...app.state.practices];
  const practices = [];
  for (let index=0; index<5; index++) {
    const title = form.get(`title-${index}`); if (!title) continue;
    practices.push({ id: form.get(`id-${index}`) || crypto.randomUUID(), title: String(title).trim(), minutes: Number(form.get(`minutes-${index}`) || 5), order: practices.length, active: true, updatedAt: nowISO() });
  }
  const newTitle = String(form.get('new-title') || '').trim();
  if (newTitle && practices.length < 5) practices.push({ id: crypto.randomUUID(), title: newTitle, minutes: 5, order: practices.length, active: true, updatedAt: nowISO() });
  const retainedIDs = new Set(practices.map(item => item.id));
  const removed = previous.filter(item => !retainedIDs.has(item.id));
  app.state.practices = practices; saveState(app.state); closeSheet(); renderToday();
  await Promise.allSettled([
    ...practices.map(item => pushEntity('practice_template', item.id, item, entityRevision(app.snapshot, 'practice_template', item.id), 'userEntered')),
    ...removed.map(item => deleteEntity('practice_template', item.id, entityRevision(app.snapshot, 'practice_template', item.id))),
  ]);
  toast('Daily practices updated');
}

async function completeSession(button) {
  const id = button.dataset.completionId;
  const record = { id, planID: button.dataset.planId, sessionID: button.dataset.sessionId, scheduledDate: button.dataset.date, completed: true, completedAt: nowISO(), source: 'userEntered' };
  button.disabled = true; button.textContent = 'Completed'; button.className = 'secondary-button';
  try { await pushEntity('plan_completion', id, record, entityRevision(app.snapshot, 'plan_completion', id), 'userEntered'); toast('Session completed'); await refreshAll({ quiet: true, force: true }); }
  catch { button.disabled = false; button.textContent = 'Mark complete'; toast('Could not sync completion'); }
}

function openSettings() {
  const whoopConnected = Boolean(app.whoop?.connected); const stravaConnected = Boolean(app.strava?.connected);
  openSheet(`<div class="sheet-head"><div><h2>Settings</h2><p>Connections, installation and your data.</p></div></div><div class="settings-list">
    ${app.syncIssue ? `<div class="settings-row quota-warning"><div><h3>Cloud sync paused</h3><p>${escapeHTML(app.syncIssue)} Use Refresh after the Neon quota resets or the project is upgraded.</p></div><span class="connection-state">CACHED</span></div>` : ''}
    <div class="settings-row"><div><h3>WHOOP</h3><p>${whoopConnected ? `Connected · ${relativeTime(app.whoop.lastSyncedAt)}` : app.syncIssue ? 'Connection status unavailable while cloud sync is paused' : 'Official API · processed recovery, sleep and workouts'}</p></div>${app.syncIssue && !whoopConnected ? '<button class="secondary-button" type="button" disabled>Status unavailable</button>' : `<button class="${whoopConnected ? 'secondary-button' : 'primary-button'}" type="button" data-action="${whoopConnected ? 'whoop-sync' : 'whoop-connect'}">${whoopConnected ? 'Sync' : 'Connect'}</button>`}</div>
    ${whoopConnected ? '<div class="settings-row"><div><h3>Disconnect WHOOP</h3><p>Imported summaries remain in history.</p></div><button class="danger-button" type="button" data-action="whoop-disconnect">Disconnect</button></div>' : ''}
    <div class="settings-row"><div><h3>Strava</h3><p>${stravaConnected ? 'Connected · webhook activity sync' : app.syncIssue ? 'Connection status unavailable while cloud sync is paused' : 'Import activities and share approved workouts'}</p></div>${app.syncIssue && !stravaConnected ? '<button class="secondary-button" type="button" disabled>Status unavailable</button>' : `<button class="${stravaConnected ? 'secondary-button' : 'primary-button'}" type="button" data-action="${stravaConnected ? 'strava-disconnect' : 'strava-connect'}">${stravaConnected ? 'Disconnect' : 'Connect'}</button>`}</div>
    <div class="settings-row"><div><h3>Genesis coach</h3><p>Workout logs and accepted schedule changes share the same encrypted Neon records.</p></div><span class="connection-state">SHARED STORE</span></div>
    <div class="settings-row"><div><h3>Apple Health Shortcut</h3><p>User-run body measurement bridge · no background HealthKit access</p></div><a class="secondary-button" style="display:grid;place-items:center;text-decoration:none" href="${HealthShortcut.setupURL}">Set up</a></div>
    <div class="settings-row"><div><h3>Write latest weight to Health</h3><p>Launches the installed Shortcut for confirmation.</p></div><button class="secondary-button" type="button" data-action="health-write">Run</button></div>
    <div class="settings-row"><div><h3>Home Screen reminders</h3><p>Workout and Dharma reminders only; never medical alerts.</p></div><button class="secondary-button" type="button" data-action="enable-notifications">Enable</button></div>
    <div class="settings-row"><div><h3>Install Kash OS</h3><p>In Comet: Share → Add to Home Screen → Add.</p><ol class="install-steps"><li>Open this URL in Comet on iPhone.</li><li>Choose Share and Add to Home Screen.</li><li>Launch the Kash OS icon for full-screen mode.</li></ol></div></div>
    <div class="settings-row"><div><h3>Export local data</h3><p>Download a readable JSON backup from this phone.</p></div><button class="secondary-button" type="button" data-action="export-data">Export</button></div>
    <div class="settings-row"><div><h3>Refresh everything</h3><p>Reconcile WHOOP, Strava, the HYROX plan and synced logs.</p></div><button class="secondary-button" type="button" data-action="refresh-app">Refresh</button></div>
    <div class="settings-row public-warning"><div><h3>Public personal app</h3><p>There is no password. Anyone with the URL can view or modify synced data, as explicitly configured.</p></div></div>
    <a class="settings-row" style="text-decoration:none;color:inherit" href="/privacy.html"><div><h3>Privacy boundary</h3><p>Review what Kash OS stores and what never reaches the server.</p></div><span>→</span></a>
  </div>`);
}

async function syncWhoop() { try { toast('Syncing WHOOP…'); await Whoop.sync(30); closeSheet(); await refreshAll({ force: true }); } catch (error) { toast(`WHOOP sync failed · ${error.message}`); } }
async function disconnectWhoop() { if (!confirm('Disconnect WHOOP? Imported summaries remain.')) return; try { await Whoop.disconnect(); closeSheet(); await refreshAll({ force: true }); } catch (error) { toast(error.message); } }
async function disconnectStrava() { if (!confirm('Disconnect Strava? Imported activities remain.')) return; try { await Strava.disconnect(); closeSheet(); await refreshAll({ force: true }); } catch (error) { toast(error.message); } }
function writeLatestToHealth() { const latest = sorted(app.state.measurements, item => item.timestamp || item.date)[0]; if (!latest) { toast('Log a body measurement first.'); return; } HealthShortcut.runWrite(latest); }

async function enableNotifications() {
  if (!('Notification' in window) || !('PushManager' in window)) { toast('Install Kash OS to the Home Screen before enabling reminders.'); return; }
  try {
    const config = await PushReminders.config();
    if (!config.available || !config.publicKey) { toast('Push reminders are not configured on the server yet.'); return; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { toast('Notification permission was not granted'); return; }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64Bytes(config.publicKey) });
    await PushReminders.subscribe({ subscription: subscription.toJSON(), categories: ['planned_workout','dharma_practice'], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    app.state.notificationPreference = true; saveState(app.state);
    toast('Daily workout and Dharma reminders enabled');
  } catch (error) { toast(`Could not enable reminders · ${error.message}`); }
}

function exportData() {
  const payload = { exportedAt: nowISO(), schemaVersion: 4, localState: app.state, syncCursor: app.snapshot.cursor };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `kash-os-backup-${localDay()}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openSheet(html) { app.lastFocus = document.activeElement; $('#sheet-content').innerHTML = html; $('#sheet-layer').hidden = false; $('#app-frame').inert = true; document.body.style.overflow = 'hidden'; setTimeout(() => $('.bottom-sheet input, .bottom-sheet button')?.focus(), 50); }
function closeSheet() { $('#sheet-layer').hidden = true; $('#app-frame').inert = false; document.body.style.overflow = ''; app.lastFocus?.focus?.(); app.lastFocus = null; }
function toast(message) { const node = $('#toast'); node.textContent = message; node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 2800); }

function focusTodayTarget(target) {
  if (!target) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  setTimeout(() => target.focus({ preventScroll: true }), reducedMotion ? 0 : 280);
}

function setupMotion() {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } }), { threshold: .08, rootMargin: '0px 0px -25px' });
  $$('[data-reveal]:not(.is-visible)').forEach(node => observer.observe(node));
}

function setupPullToRefresh() {
  let startY = null; let pulling = false;
  window.addEventListener('touchstart', event => { if (scrollY <= 0 && event.touches.length === 1) startY = event.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', event => { if (startY == null || scrollY > 0) return; const distance = event.touches[0].clientY - startY; pulling = distance > 72; if (distance > 25) { $('#pull-indicator').textContent = pulling ? 'Release to refresh' : 'Pull to refresh'; $('#pull-indicator').classList.add('is-visible'); } }, { passive: true });
  window.addEventListener('touchend', () => { if (pulling) refreshAll({ force: true }); else $('#pull-indicator').classList.remove('is-visible'); startY = null; pulling = false; }, { passive: true });
}

function setupSheetDrag() {
  const sheet = $('#bottom-sheet');
  let startY = null;
  sheet.addEventListener('touchstart', event => {
    if (sheet.scrollTop === 0 && event.touches.length === 1) startY = event.touches[0].clientY;
  }, { passive: true });
  sheet.addEventListener('touchmove', event => {
    if (startY == null) return;
    const distance = Math.max(0, event.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${Math.min(distance, 180)}px)`;
    sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchend', event => {
    if (startY == null) return;
    const distance = event.changedTouches[0].clientY - startY;
    sheet.style.transition = '';
    sheet.style.transform = '';
    startY = null;
    if (distance > 110) closeSheet();
  }, { passive: true });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' });
      await registration.update();
      if (registration.waiting) toast('A Kash OS update is ready. Reopen the app to apply it.');
      registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', () => { if (registration.installing?.state === 'installed' && navigator.serviceWorker.controller) toast('Kash OS was updated.'); }));
    } catch { /* The online app remains usable without an offline worker. */ }
  });
}

function updateConnectivity() {
  $('.offline-pill')?.remove();
  if (app.online) return;
  const pill = document.createElement('div'); pill.className = 'offline-pill'; pill.textContent = `Offline · showing saved data from ${relativeTime(app.state.lastRefreshAt)}`; document.body.append(pill);
}

function quickAction(kind, icon, label) { return `<button class="quick-action" type="button" data-action="open-log" data-log-kind="${kind}"><span aria-hidden="true" style="color:var(--lime);font-size:1.1rem">${icon}</span><span>${label}</span></button>`; }
function emptyRow(title, copy) { return `<article class="card empty-state" data-reveal><strong>${title}</strong>${copy}</article>`; }
function metricValue(metric, decimals) { return metric?.value == null ? '—' : `${Number(metric.value).toFixed(decimals)}${metric.unit === '%' ? '%' : ''}`; }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'; }
function formatDate(value) { if (!value) return 'Date unavailable'; const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00` : value); return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString([], { day: 'numeric', month: 'short', year: parsed.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); }
function relativeTime(value) { if (!value) return 'not synced yet'; const time = new Date(value).getTime(); if (!Number.isFinite(time)) return 'not synced yet'; const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000)); return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes/60)}h ago` : `${Math.round(minutes/1440)}d ago`; }
function daysToRace() { return Math.max(0, Math.ceil((new Date('2026-09-18T06:00:00+05:30') - new Date()) / 86_400_000)); }
function sorted(values, getter) { return [...(values || [])].sort((a,b) => new Date(getter(b) || 0) - new Date(getter(a) || 0)); }
function dateWithOffset(start, offset) { const date = new Date(start); date.setDate(date.getDate() + offset); return localDay(date); }
function urlBase64Bytes(value) { const padding = '='.repeat((4 - value.length % 4) % 4); const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
