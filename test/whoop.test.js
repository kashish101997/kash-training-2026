import { createHmac } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapBodyMeasurement, mapCycle, mapRecovery, mapSleep, mapWhoopWorkout,
  safeWhoopOAuthReason, verifyWhoopWebhookSignature,
} from '../lib/whoop.js';

test('reduces WHOOP OAuth failures to safe user-facing reason codes', () => {
  assert.equal(safeWhoopOAuthReason(new Error('whoop_oauth_401:invalid_client')), 'provider_invalid_client');
  assert.equal(safeWhoopOAuthReason(new Error('whoop_invalid_scope')), 'whoop_invalid_scope');
  assert.equal(safeWhoopOAuthReason(new Error('secret-token-value')), 'unexpected_oauth_error');
});

test('maps an official WHOOP workout to a route-free web summary', () => {
  const result = mapWhoopWorkout({
    id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
    start: '2026-08-10T05:00:00Z', end: '2026-08-10T06:00:00Z',
    timezone_offset: '+05:30', sport_name: 'running', sport_id: 1,
    score_state: 'SCORED', updated_at: '2026-08-10T06:05:00Z',
    score: { strain: 12.4, average_heart_rate: 151, max_heart_rate: 181, distance_meter: 10000, percent_recorded: 99 },
  });
  assert.equal(result.modality, 'run');
  assert.equal(result.movingSeconds, 3600);
  assert.equal(result.distanceMeters, 10000);
  assert.equal(result.whoop.strain, 12.4);
  assert.equal('route' in result, false);
  assert.equal('heartRateSamples' in result, false);
});

test('maps scored and pending WHOOP metrics without inventing unavailable values', () => {
  const cycle = mapCycle({ id: 7, start: '2026-08-10T00:00:00Z', score_state: 'PENDING_SCORE', score: null });
  const recovery = mapRecovery({ cycle_id: 7, sleep_id: 'sleep-7', score_state: 'UNSCORABLE' });
  assert.equal(cycle.strain, null);
  assert.equal(recovery.recoveryScore, null);
  assert.equal(cycle.scoreState, 'PENDING_SCORE');
});

test('maps sleep stages and body measurements from documented v2 fields', () => {
  const sleep = mapSleep({
    id: 'sleep-1', cycle_id: 4, start: '2026-08-09T20:00:00Z', end: '2026-08-10T04:00:00Z',
    nap: false, score_state: 'SCORED',
    score: { stage_summary: {
      total_light_sleep_time_milli: 10_000,
      total_slow_wave_sleep_time_milli: 20_000,
      total_rem_sleep_time_milli: 30_000,
    }, sleep_performance_percentage: 88 },
  });
  const body = mapBodyMeasurement({ height_meter: 1.82, weight_kilogram: 90.5, max_heart_rate: 193 });
  assert.equal(sleep.totalSleepMilliseconds, 60_000);
  assert.equal(sleep.performancePercentage, 88);
  assert.equal(body.weightKilograms, 90.5);
});

test('validates WHOOP HMAC over timestamp plus exact raw body and rejects replay', () => {
  const raw = Buffer.from('{"type":"workout.updated"}');
  const secret = 'client-secret';
  const now = Date.UTC(2026, 7, 11, 10, 0, 0);
  const timestamp = String(now);
  const signature = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(timestamp), raw])).digest('base64');
  assert.equal(verifyWhoopWebhookSignature(raw, signature, timestamp, secret, now), true);
  assert.equal(verifyWhoopWebhookSignature(Buffer.from('{}'), signature, timestamp, secret, now), false);
  assert.equal(verifyWhoopWebhookSignature(raw, signature, String(now - 7_200_001), secret, now), false);
});
