export const AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  PENDING: 'pending',
  UNSCORABLE: 'unscorable',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale',
});

export function metricEnvelope({ value, unit, source, computedAt, status, confidence = 'reported' }) {
  const hasValue = value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const timestamp = computedAt ? new Date(computedAt) : null;
  const stale = timestamp && Number.isFinite(timestamp.getTime()) && Date.now() - timestamp.getTime() > 36 * 60 * 60_000;
  return Object.freeze({
    value: hasValue ? Number(value) : null,
    unit: unit || '',
    source: source || 'Unavailable',
    confidence,
    computedAt: timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null,
    availability: status || (hasValue ? (stale ? AVAILABILITY.STALE : AVAILABILITY.AVAILABLE) : AVAILABILITY.UNAVAILABLE),
  });
}

export function whoopMetrics(status) {
  const latest = status?.latest || {};
  const recovery = latest.recovery || {};
  const sleep = latest.sleep || {};
  const cycle = latest.cycle || {};
  const pending = value => value && value !== 'SCORED' ? AVAILABILITY.PENDING : undefined;
  return {
    recovery: metricEnvelope({ value: recovery.recoveryScore, unit: '%', source: 'WHOOP · Recovery', computedAt: recovery.updatedAt || status?.lastSyncedAt, status: pending(recovery.scoreState) }),
    sleep: metricEnvelope({ value: sleep.performancePercentage, unit: '%', source: 'WHOOP · Sleep', computedAt: sleep.endedAt || status?.lastSyncedAt, status: pending(sleep.scoreState) }),
    strain: metricEnvelope({ value: cycle.strain, unit: '/21', source: 'WHOOP · Cycle', computedAt: cycle.updatedAt || cycle.startedAt || status?.lastSyncedAt, status: pending(cycle.scoreState) }),
    hrv: metricEnvelope({ value: recovery.hrvRMSSDMilliseconds, unit: 'ms', source: 'WHOOP · Recovery', computedAt: recovery.updatedAt || status?.lastSyncedAt }),
    rhr: metricEnvelope({ value: recovery.restingHeartRate, unit: 'bpm', source: 'WHOOP · Recovery', computedAt: recovery.updatedAt || status?.lastSyncedAt }),
    respiration: metricEnvelope({ value: sleep.respiratoryRate, unit: 'rpm', source: 'WHOOP · Sleep', computedAt: sleep.endedAt || status?.lastSyncedAt }),
  };
}

export function dailyBrief(metrics, plannedSession) {
  const recovery = metrics.recovery.value;
  const sleep = metrics.sleep.value;
  const strain = metrics.strain.value;
  const session = plannedSession?.title || plannedSession?.name || null;
  if (recovery == null && sleep == null && strain == null) {
    return { level: 'unavailable', title: session ? `Keep ${session} flexible` : 'Build the picture first', body: 'WHOOP has not supplied enough scored data for a recovery recommendation. Use how you feel and keep the planned effort adjustable.', rule: 'No scored recovery inputs — no guessed recommendation.' };
  }
  if ((recovery != null && recovery < 34) || (sleep != null && sleep < 60)) {
    return { level: 'recover', title: 'Protect recovery today', body: session ? `Keep ${session} easy, shorten it, or move it if fatigue stays high after the warm-up.` : 'Choose gentle movement, hydration, regular meals and an earlier night.', rule: 'Recovery <34% or sleep performance <60%.' };
  }
  if ((recovery != null && recovery < 67) || (sleep != null && sleep < 75)) {
    return { level: 'steady', title: session ? `Train, but leave margin` : 'Choose steady work', body: session ? `${session} can stay on the plan. Hold back one gear and stop if form or pace deteriorates.` : 'Moderate work fits the available signals; avoid adding unplanned intensity.', rule: 'Moderate recovery or sleep below 75%.' };
  }
  if (strain != null && strain >= 17) {
    return { level: 'hold', title: 'The load is already high', body: 'Recovery is supportive, but today’s accumulated strain is high. Avoid stacking another hard effort without a clear reason.', rule: 'Day strain ≥17.' };
  }
  return { level: 'go', title: session ? `Good day for ${session}` : 'Capacity is available', body: 'The scored signals support the planned work. Execute the session rather than adding extra volume.', rule: 'Recovery ≥67%, sleep ≥75%, and strain below 17.' };
}

export function localDay(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function practiceStreak(completions, practiceID, today = new Date()) {
  const completeDays = new Set(completions.filter(item => item.practiceID === practiceID && item.completed).map(item => item.day));
  let streak = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!completeDays.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (completeDays.has(localDay(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function applyPlanAdjustments(sessions, adjustments) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const latestBySession = new Map();
  for (const adjustment of adjustments || []) {
    if (!adjustment || adjustment.active === false || !datePattern.test(String(adjustment.scheduledDate || ''))) continue;
    const key = `${adjustment.planID || ''}:${adjustment.sessionID || ''}`;
    if (key === ':') continue;
    const current = latestBySession.get(key);
    if (!current || String(adjustment.updatedAt || '') >= String(current.updatedAt || '')) latestBySession.set(key, adjustment);
  }
  return (sessions || []).map(session => {
    const adjustment = latestBySession.get(`${session.planID || ''}:${session.id || ''}`);
    if (!adjustment || adjustment.scheduledDate === session.scheduledDate) return session;
    return {
      ...session,
      originalScheduledDate: session.scheduledDate,
      scheduledDate: adjustment.scheduledDate,
      planAdjustment: adjustment,
    };
  });
}

export function recoveryColor(score) {
  if (score == null) return '#70766d';
  if (score < 34) return '#ff5b5b';
  if (score < 67) return '#f1c845';
  return '#20d66b';
}
