import test from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABILITY, applyPlanAdjustments, dailyBrief, localDay, metricEnvelope, practiceStreak, todayFocus, workoutDetails } from '../app/models.js';
import { DEFAULT_PRACTICES, mergeRemoteState, migrateLegacy } from '../app/state.js';

test('metric envelope never invents unavailable values', () => {
  const unavailable = metricEnvelope({ value: null, unit: '%', source: 'WHOOP' });
  assert.equal(unavailable.value, null);
  assert.equal(unavailable.availability, AVAILABILITY.UNAVAILABLE);
  const available = metricEnvelope({ value: '72', unit: '%', source: 'WHOOP' });
  assert.equal(available.value, 72);
  assert.ok([AVAILABILITY.AVAILABLE, AVAILABILITY.STALE].includes(available.availability));
});

test('daily brief is deterministic and conservative', () => {
  const metrics = {
    recovery: metricEnvelope({ value: 31 }), sleep: metricEnvelope({ value: 82 }), strain: metricEnvelope({ value: 4 }),
  };
  assert.equal(dailyBrief(metrics, { title: 'Intervals' }).level, 'recover');
  assert.equal(dailyBrief(metrics, { title: 'Intervals' }).title, 'Protect recovery today');
  const missing = Object.fromEntries(['recovery','sleep','strain'].map(key => [key, metricEnvelope({ value: null })]));
  assert.equal(dailyBrief(missing, null).level, 'unavailable');
});

test('practice streak uses local days and permits yesterday as the active edge', () => {
  const today = new Date(2026, 7, 13, 8, 0, 0);
  const completions = [10, 11, 12].map(day => ({ practiceID: 'p', day: `2026-08-${day}`, completed: true }));
  assert.equal(practiceStreak(completions, 'p', today), 3);
  completions.push({ practiceID: 'p', day: '2026-08-13', completed: true });
  assert.equal(practiceStreak(completions, 'p', today), 4);
  assert.equal(localDay(today), '2026-08-13');
});

test('today focus exposes one concrete next action and forgiving completion state', () => {
  const practices = [
    { id: 'breath', title: 'Five quiet breaths', minutes: 2, active: true },
    { id: 'review', title: 'Evening review', minutes: 5, active: true },
  ];
  const session = { id: 'run', title: 'HYROX intervals', durationSeconds: 3600 };
  const workoutFirst = todayFocus({ session, practices, completedPracticeIDs: ['breath'] });
  assert.equal(workoutFirst.kind, 'session');
  assert.equal(workoutFirst.durationMinutes, 60);
  assert.equal(workoutFirst.progress, 33);

  const practiceNext = todayFocus({ session, sessionCompleted: true, practices, completedPracticeIDs: ['breath'] });
  assert.equal(practiceNext.kind, 'practice');
  assert.equal(practiceNext.targetID, 'review');
  assert.equal(practiceNext.progress, 67);

  const complete = todayFocus({ session, sessionCompleted: true, practices, completedPracticeIDs: ['breath', 'review'] });
  assert.equal(complete.kind, 'complete');
  assert.equal(complete.progress, 100);
  assert.match(complete.body, /stop here/i);
});

test('legacy migration is idempotent and preserves logs', () => {
  const legacy = {
    weights: [{ id: 'w1', date: '2026-08-13', kg: 94.65 }],
    measurements: [{ id: 'm1', date: '2026-08-12', weight: 95 }],
    bloodSugar: [{ id: 'g1', date: '2026-08-13', value: 96 }],
    workouts: [{ id: 'x1', date: '2026-08-10', name: 'Run' }],
  };
  const once = migrateLegacy(legacy);
  const twice = migrateLegacy({ measurements: once.measurements, bloodSugar: once.bloodSugar, workouts: once.workouts });
  assert.equal(once.measurements.length, 2);
  assert.equal(new Set(once.measurements.map(item => item.id)).size, 2);
  assert.equal(twice.measurements.length, 2);
  assert.equal(once.bloodSugar.length, 1);
  assert.equal(once.workouts.length, 1);
  assert.equal(once.practices.length, DEFAULT_PRACTICES.length);
});

test('remote legacy weight values remain visible as body measurements', () => {
  const entities = new Map([
    ['weight-1', { id: 'weight-1', kind: 'weights', revision: 2, data: { date: '2026-04-20', value: 95.75, source: 'manual' } }],
  ]);
  const merged = mergeRemoteState(migrateLegacy(null), entities);
  assert.equal(merged.measurements.length, 1);
  assert.equal(merged.measurements[0].weightKilograms, 95.75);
  assert.equal(merged.measurements[0].timestamp, '2026-04-20T06:00:00');
});

test('retired Gita practice is removed from defaults, migration, and remote sync', () => {
  assert.equal(DEFAULT_PRACTICES.some(item => /gita verse/i.test(item.title)), false);
  const migrated = migrateLegacy({ dharmaPractices: [
    { id: 'dharma-verse', title: 'Read one Gita verse' },
    { id: 'keep', title: 'Five quiet breaths' },
  ] });
  assert.deepEqual(migrated.practices.map(item => item.id), ['keep']);
  const entities = new Map([
    ['practice_template:dharma-verse', { id: 'dharma-verse', kind: 'practice_template', revision: 2, data: { id: 'dharma-verse', title: 'Read one Gita verse' } }],
    ['practice_template:keep', { id: 'keep', kind: 'practice_template', revision: 1, data: { id: 'keep', title: 'Evening review' } }],
  ]);
  assert.deepEqual(mergeRemoteState(migrated, entities).practices.map(item => item.id), ['keep']);
});

test('workout details prefer structured segments and preserve fallback instructions', () => {
  assert.deepEqual(workoutDetails({ segments: [{ instructions: 'SkiErg', target: '3 x 250 m' }] }), [{ name: 'SkiErg', target: '3 x 250 m' }]);
  assert.deepEqual(workoutDetails({ instructions: 'Warm-up: 10 min · Main set: 4 x 1 km' }), [
    { name: 'Warm-up', target: '10 min' }, { name: 'Main set', target: '4 x 1 km' },
  ]);
});

test('accepted Genesis adjustments move stable plan sessions without rewriting their identity', () => {
  const sessions = [{ id: 'session-7', planID: 'hyrox-2026', scheduledDate: '2026-08-17', title: 'Intervals' }];
  const adjusted = applyPlanAdjustments(sessions, [{
    id: 'plan-adjustment:hyrox-2026:session-7', planID: 'hyrox-2026', sessionID: 'session-7',
    originalDate: '2026-08-17', scheduledDate: '2026-08-19', reason: 'Recovery', updatedAt: '2026-08-14T12:00:00Z',
  }]);
  assert.equal(adjusted[0].id, 'session-7');
  assert.equal(adjusted[0].scheduledDate, '2026-08-19');
  assert.equal(adjusted[0].originalScheduledDate, '2026-08-17');
  assert.equal(sessions[0].scheduledDate, '2026-08-17');
});

test('inactive or malformed plan adjustments leave the source schedule unchanged', () => {
  const sessions = [{ id: 'session-8', planID: 'hyrox-2026', scheduledDate: '2026-08-20' }];
  const adjusted = applyPlanAdjustments(sessions, [
    { planID: 'hyrox-2026', sessionID: 'session-8', scheduledDate: 'tomorrow' },
    { planID: 'hyrox-2026', sessionID: 'session-8', scheduledDate: '2026-08-22', active: false },
  ]);
  assert.deepEqual(adjusted, sessions);
});
