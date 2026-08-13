import test from 'node:test';
import assert from 'node:assert/strict';
import { mapActivity, workoutToTCX } from '../lib/strava.js';

test('maps Strava summary without route or raw stream data', () => {
  const result = mapActivity({ id: 42, sport_type: 'Run', name: 'Easy Run', start_date: '2026-08-06T05:00:00Z', elapsed_time: 1800, moving_time: 1700, distance: 5000, average_heartrate: 145 });
  assert.equal(result.modality, 'run');
  assert.equal(result.distanceMeters, 5000);
  assert.equal('route' in result, false);
  assert.deepEqual(result.externalIDs, { strava: '42' });
});

test('cardio export is valid summary TCX', () => {
  const tcx = workoutToTCX({ id: 'abc', modality: 'run', startedAt: '2026-08-06T05:00:00Z', movingSeconds: 1800, distanceMeters: 5000 });
  assert.match(tcx, /TrainingCenterDatabase/);
  assert.match(tcx, /<DistanceMeters>5000<\/DistanceMeters>/);
  assert.doesNotMatch(tcx, /Trackpoint/);
});

