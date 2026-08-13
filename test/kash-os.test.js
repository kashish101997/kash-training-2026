import test from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABILITY, dailyBrief, localDay, metricEnvelope, practiceStreak } from '../app/models.js';
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
