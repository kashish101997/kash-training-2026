import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { db, one } from './db.js';
import { decryptJSON, encryptJSON, randomToken, sha256 } from './crypto.js';
import { encodePayload } from './merge.js';
import { applyMutation } from './sync-store.js';

const PROVIDER = 'whoop';
const API_BASE = 'https://api.prod.whoop.com/developer/v2';
const AUTHORIZE_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_SCOPES = [
  'offline', 'read:profile', 'read:body_measurement', 'read:cycles',
  'read:recovery', 'read:sleep', 'read:workout',
];
const WEBHOOK_TYPES = new Set([
  'workout.updated', 'workout.deleted', 'sleep.updated', 'sleep.deleted',
  'recovery.updated', 'recovery.deleted',
]);
const tokenAAD = accountId => `${accountId}:oauth:${PROVIDER}`;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function requireConfiguration() {
  for (const name of ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET', 'PUBLIC_APP_URL']) {
    if (!process.env[name]) throw new Error(`${name}_not_configured`);
  }
}

export async function createWhoopAuthorization(accountId) {
  requireConfiguration();
  // WHOOP requires an eight-character OAuth state value. Six random bytes encode to
  // exactly eight base64url characters without padding.
  const state = randomToken(6);
  const sql = await db();
  await sql`
    INSERT INTO integration_oauth_states (state_hash, account_id, expires_at, provider)
    VALUES (${sha256(state)}, ${accountId}, now() + interval '10 minutes', ${PROVIDER})
  `;
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID,
    redirect_uri: `${process.env.PUBLIC_APP_URL}/api/whoop/callback`,
    response_type: 'code',
    scope: WHOOP_SCOPES.join(' '),
    state,
  }).toString();
  return url;
}

export async function consumeWhoopOAuthState(state) {
  if (!/^[A-Za-z0-9_-]{8}$/.test(state)) return null;
  const sql = await db();
  return one(await sql`
    UPDATE integration_oauth_states SET consumed_at = now()
    WHERE state_hash = ${sha256(state)} AND provider = ${PROVIDER}
      AND consumed_at IS NULL AND expires_at > now()
    RETURNING account_id
  `);
}

async function tokenRequest(parameters) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(parameters),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`whoop_oauth_${response.status}:${payload.error || 'request_failed'}`);
  if (!payload.access_token) throw new Error('whoop_oauth_missing_access_token');
  return payload;
}

async function storeWhoopTokens(accountId, tokens, externalAccountId = '') {
  const sql = await db();
  const expiresAt = tokens.expires_at
    ? Number(tokens.expires_at)
    : Math.floor(Date.now() / 1000) + Number(tokens.expires_in || 3600);
  const encrypted = encryptJSON({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    scope: tokens.scope || WHOOP_SCOPES.join(' '),
  }, tokenAAD(accountId));
  await sql`
    INSERT INTO oauth_tokens (account_id, provider, external_account_id, encrypted_payload, updated_at)
    VALUES (${accountId}, ${PROVIDER}, ${String(externalAccountId || '')}, ${JSON.stringify(encrypted)}::jsonb, now())
    ON CONFLICT (account_id, provider) DO UPDATE SET
      external_account_id = CASE WHEN excluded.external_account_id = ''
        THEN oauth_tokens.external_account_id ELSE excluded.external_account_id END,
      encrypted_payload = excluded.encrypted_payload,
      updated_at = now()
  `;
}

export async function exchangeWhoopAuthorizationCode(accountId, code) {
  requireConfiguration();
  if (!code) throw new Error('missing_authorization_code');
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    redirect_uri: `${process.env.PUBLIC_APP_URL}/api/whoop/callback`,
  });
  if (!tokens.refresh_token) throw new Error('whoop_offline_scope_not_granted');
  await storeWhoopTokens(accountId, tokens);
  const profile = await whoopFetch('/user/profile/basic', tokens.access_token);
  await storeWhoopTokens(accountId, tokens, profile.user_id);
  await upsertWhoopRecord(accountId, 'whoop_profile', 'whoop:profile', mapProfile(profile));
  return mapProfile(profile);
}

async function tokenRow(accountId) {
  const sql = await db();
  return one(await sql`
    SELECT external_account_id, encrypted_payload FROM oauth_tokens
    WHERE account_id = ${accountId} AND provider = ${PROVIDER}
  `);
}

async function acquireRefreshLease(accountId) {
  const leaseID = randomUUID();
  const sql = await db();
  const row = await one(await sql`
    INSERT INTO oauth_refresh_leases (account_id, provider, lease_id, lease_until)
    VALUES (${accountId}, ${PROVIDER}, ${leaseID}, now() + interval '30 seconds')
    ON CONFLICT (account_id, provider) DO UPDATE SET
      lease_id = excluded.lease_id, lease_until = excluded.lease_until
    WHERE oauth_refresh_leases.lease_until < now()
    RETURNING lease_id
  `);
  return row?.lease_id === leaseID ? leaseID : null;
}

async function releaseRefreshLease(accountId, leaseID) {
  const sql = await db();
  await sql`
    DELETE FROM oauth_refresh_leases
    WHERE account_id = ${accountId} AND provider = ${PROVIDER} AND lease_id = ${leaseID}
  `;
}

export async function whoopAccessToken(accountId) {
  requireConfiguration();
  for (let attempt = 0; attempt < 12; attempt++) {
    const row = await tokenRow(accountId);
    if (!row) throw new Error('whoop_not_connected');
    const tokens = decryptJSON(row.encrypted_payload, tokenAAD(accountId));
    if (Number(tokens.expiresAt) > Math.floor(Date.now() / 1000) + 300) return tokens.accessToken;
    const leaseID = await acquireRefreshLease(accountId);
    if (!leaseID) {
      await wait(250);
      continue;
    }
    try {
      const refreshed = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        scope: 'offline',
      });
      if (!refreshed.refresh_token) throw new Error('whoop_refresh_missing_rotated_token');
      await storeWhoopTokens(accountId, refreshed, row.external_account_id);
      return refreshed.access_token;
    } finally {
      await releaseRefreshLease(accountId, leaseID).catch(() => {});
    }
  }
  throw new Error('whoop_refresh_in_progress');
}

async function whoopFetch(path, accessToken) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    const error = new Error(`whoop_api_${response.status}`);
    error.status = response.status;
    error.retryAfter = response.headers.get('x-ratelimit-reset') || response.headers.get('retry-after');
    throw error;
  }
  return response.json();
}

async function whoopCollection(path, accessToken, { start, end, maximumPages = 100 } = {}) {
  const records = [];
  let nextToken = null;
  for (let page = 0; page < maximumPages; page++) {
    const url = new URL(`${API_BASE}${path}`);
    url.searchParams.set('limit', '25');
    if (start) url.searchParams.set('start', start);
    if (end) url.searchParams.set('end', end);
    if (nextToken) url.searchParams.set('nextToken', nextToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      const error = new Error(`whoop_api_${response.status}`);
      error.status = response.status;
      error.retryAfter = response.headers.get('x-ratelimit-reset') || response.headers.get('retry-after');
      throw error;
    }
    const payload = await response.json();
    records.push(...(payload.records || []));
    nextToken = payload.next_token || null;
    if (!nextToken) break;
  }
  return records;
}

function numberOrNull(value) {
  return value == null || Number.isNaN(Number(value)) ? null : Number(value);
}

export function mapProfile(profile) {
  return {
    userID: String(profile.user_id),
    firstName: profile.first_name || '',
    lastName: profile.last_name || '',
    source: PROVIDER,
  };
}

export function mapBodyMeasurement(body) {
  return {
    heightMeters: numberOrNull(body.height_meter),
    weightKilograms: numberOrNull(body.weight_kilogram),
    maxHeartRate: numberOrNull(body.max_heart_rate),
    source: PROVIDER,
    availability: body ? 'available' : 'unavailable',
  };
}

export function mapCycle(cycle) {
  return {
    id: String(cycle.id),
    startedAt: cycle.start,
    endedAt: cycle.end || null,
    timezoneOffset: cycle.timezone_offset,
    scoreState: cycle.score_state,
    strain: numberOrNull(cycle.score?.strain),
    kilojoules: numberOrNull(cycle.score?.kilojoule),
    averageHeartRate: numberOrNull(cycle.score?.average_heart_rate),
    maxHeartRate: numberOrNull(cycle.score?.max_heart_rate),
    source: PROVIDER,
    updatedAt: cycle.updated_at,
  };
}

export function mapRecovery(recovery) {
  return {
    cycleID: String(recovery.cycle_id),
    sleepID: String(recovery.sleep_id),
    scoreState: recovery.score_state,
    recoveryScore: numberOrNull(recovery.score?.recovery_score),
    restingHeartRate: numberOrNull(recovery.score?.resting_heart_rate),
    hrvRMSSDMilliseconds: numberOrNull(recovery.score?.hrv_rmssd_milli),
    spo2Percentage: numberOrNull(recovery.score?.spo2_percentage),
    skinTemperatureCelsius: numberOrNull(recovery.score?.skin_temp_celsius),
    userCalibrating: recovery.score?.user_calibrating ?? null,
    source: PROVIDER,
    updatedAt: recovery.updated_at,
  };
}

export function mapSleep(sleep) {
  const stages = sleep.score?.stage_summary || {};
  const light = numberOrNull(stages.total_light_sleep_time_milli) || 0;
  const slowWave = numberOrNull(stages.total_slow_wave_sleep_time_milli) || 0;
  const rem = numberOrNull(stages.total_rem_sleep_time_milli) || 0;
  return {
    id: String(sleep.id),
    cycleID: String(sleep.cycle_id),
    startedAt: sleep.start,
    endedAt: sleep.end,
    timezoneOffset: sleep.timezone_offset,
    nap: Boolean(sleep.nap),
    scoreState: sleep.score_state,
    totalSleepMilliseconds: light + slowWave + rem,
    stageSummary: {
      inBedMilliseconds: numberOrNull(stages.total_in_bed_time_milli),
      awakeMilliseconds: numberOrNull(stages.total_awake_time_milli),
      noDataMilliseconds: numberOrNull(stages.total_no_data_time_milli),
      lightMilliseconds: light,
      slowWaveMilliseconds: slowWave,
      remMilliseconds: rem,
      cycleCount: numberOrNull(stages.sleep_cycle_count),
      disturbanceCount: numberOrNull(stages.disturbance_count),
    },
    respiratoryRate: numberOrNull(sleep.score?.respiratory_rate),
    performancePercentage: numberOrNull(sleep.score?.sleep_performance_percentage),
    consistencyPercentage: numberOrNull(sleep.score?.sleep_consistency_percentage),
    efficiencyPercentage: numberOrNull(sleep.score?.sleep_efficiency_percentage),
    source: PROVIDER,
    updatedAt: sleep.updated_at,
  };
}

function modalityForSport(sportName = '') {
  const value = String(sportName).toLowerCase();
  if (/run|jog|track|cross country/.test(value)) return 'run';
  if (/walk|hike|ruck/.test(value)) return 'walk';
  if (/cycle|cycling|bike|spin/.test(value)) return 'cycle';
  if (/strength|weight|powerlift|functional fitness/.test(value)) return 'strength';
  if (/hyrox|crossfit/.test(value)) return 'hyrox';
  if (/cricket|bowling/.test(value)) return 'bowling';
  if (/swim/.test(value)) return 'swim';
  return 'other';
}

export function mapWhoopWorkout(workout) {
  const start = Date.parse(workout.start);
  const end = Date.parse(workout.end);
  const duration = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : null;
  return {
    id: `whoop:${workout.id}`,
    startedAt: workout.start,
    endedAt: workout.end,
    timezoneOffset: workout.timezone_offset,
    modality: modalityForSport(workout.sport_name),
    title: workout.sport_name ? `WHOOP · ${workout.sport_name}` : 'WHOOP workout',
    movingSeconds: duration,
    distanceMeters: numberOrNull(workout.score?.distance_meter),
    averageHeartRate: numberOrNull(workout.score?.average_heart_rate),
    maxHeartRate: numberOrNull(workout.score?.max_heart_rate),
    source: PROVIDER,
    scoreState: workout.score_state,
    whoop: {
      workoutID: String(workout.id),
      sportID: numberOrNull(workout.sport_id),
      sportName: workout.sport_name || null,
      strain: numberOrNull(workout.score?.strain),
      kilojoules: numberOrNull(workout.score?.kilojoule),
      percentRecorded: numberOrNull(workout.score?.percent_recorded),
      altitudeGainMeters: numberOrNull(workout.score?.altitude_gain_meter),
      zoneDurationsMilliseconds: workout.score?.zone_durations || null,
    },
    externalIDs: { whoop: String(workout.id) },
    updatedAt: workout.updated_at,
  };
}

function deterministicUUID(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

async function upsertWhoopRecord(accountId, kind, entityID, record, eventSeed = '') {
  const versionSeed = eventSeed || record.updatedAt || createHash('sha256').update(JSON.stringify(record)).digest('hex');
  return applyMutation(accountId, PROVIDER, {
    mutationID: deterministicUUID(`${PROVIDER}:${kind}:${entityID}:${versionSeed}`),
    entityID,
    kind,
    baseVersion: 0,
    tombstone: false,
    provenance: PROVIDER,
    payloadBase64: encodePayload(record),
  });
}

async function deleteWhoopRecord(accountId, kind, entityID, eventSeed) {
  return applyMutation(accountId, PROVIDER, {
    mutationID: deterministicUUID(`${PROVIDER}:delete:${kind}:${entityID}:${eventSeed}`),
    entityID,
    kind,
    baseVersion: 0,
    tombstone: true,
    provenance: PROVIDER,
  });
}

async function inBatches(items, worker, batchSize = 8) {
  for (let offset = 0; offset < items.length; offset += batchSize) {
    await Promise.all(items.slice(offset, offset + batchSize).map(worker));
  }
}

export async function syncWhoopAccount(accountId, { days = 30 } = {}) {
  const safeDays = Math.min(365, Math.max(1, Number(days) || 30));
  const sql = await db();
  try {
    const token = await whoopAccessToken(accountId);
    const end = new Date().toISOString();
    const start = new Date(Date.now() - safeDays * 86_400_000).toISOString();
    const [profile, body, cycles, recoveries, sleeps, workouts] = await Promise.all([
      whoopFetch('/user/profile/basic', token),
      whoopFetch('/user/measurement/body', token),
      whoopCollection('/cycle', token, { start, end }),
      whoopCollection('/recovery', token, { start, end }),
      whoopCollection('/activity/sleep', token, { start, end }),
      whoopCollection('/activity/workout', token, { start, end }),
    ]);
    await upsertWhoopRecord(accountId, 'whoop_profile', 'whoop:profile', mapProfile(profile));
    await upsertWhoopRecord(accountId, 'whoop_body', 'whoop:body', mapBodyMeasurement(body));
    await inBatches(cycles, record => upsertWhoopRecord(accountId, 'whoop_cycle', `whoop:${record.id}`, mapCycle(record)));
    await inBatches(recoveries, record => upsertWhoopRecord(accountId, 'whoop_recovery', `whoop:${record.sleep_id}`, mapRecovery(record)));
    await inBatches(sleeps, record => upsertWhoopRecord(accountId, 'whoop_sleep', `whoop:${record.id}`, mapSleep(record)));
    await inBatches(workouts, record => upsertWhoopRecord(accountId, 'workout', `whoop:${record.id}`, mapWhoopWorkout(record)));
    await sql`
      INSERT INTO integration_sync_state (account_id, provider, last_synced_at, last_error, updated_at)
      VALUES (${accountId}, ${PROVIDER}, now(), NULL, now())
      ON CONFLICT (account_id, provider) DO UPDATE SET
        last_synced_at = now(), last_error = NULL, updated_at = now()
    `;
    return {
      days: safeDays,
      counts: { cycles: cycles.length, recoveries: recoveries.length, sleeps: sleeps.length, workouts: workouts.length },
    };
  } catch (error) {
    await sql`
      INSERT INTO integration_sync_state (account_id, provider, last_error, updated_at)
      VALUES (${accountId}, ${PROVIDER}, ${String(error.message).slice(0, 500)}, now())
      ON CONFLICT (account_id, provider) DO UPDATE SET last_error = excluded.last_error, updated_at = now()
    `.catch(() => {});
    throw error;
  }
}

export async function getWhoopDashboard(accountId) {
  const sql = await db();
  const connection = await one(await sql`
    SELECT external_account_id, updated_at FROM oauth_tokens
    WHERE account_id = ${accountId} AND provider = ${PROVIDER}
  `);
  const syncState = await one(await sql`
    SELECT last_synced_at, last_error FROM integration_sync_state
    WHERE account_id = ${accountId} AND provider = ${PROVIDER}
  `);
  const rows = await sql`
    SELECT kind, entity_id, encrypted_payload, updated_at
    FROM sync_entities
    WHERE account_id = ${accountId} AND tombstone = false
      AND kind IN ('whoop_profile', 'whoop_body', 'whoop_cycle', 'whoop_recovery', 'whoop_sleep', 'workout')
    ORDER BY updated_at DESC LIMIT 500
  `;
  const records = [];
  for (const row of rows) {
    if (row.kind === 'workout' && !row.entity_id.startsWith('whoop:')) continue;
    try {
      const decrypted = decryptJSON(row.encrypted_payload, `${accountId}:${row.kind}:${row.entity_id}`);
      records.push({ kind: row.kind, entityID: row.entity_id, storedAt: row.updated_at, data: decrypted.data });
    } catch (error) {
      console.error('[whoop-dashboard-decrypt]', row.entity_id, error.message);
    }
  }
  const byKind = kind => records.filter(record => record.kind === kind);
  const latestBy = (kind, field) => byKind(kind).sort((a, b) =>
    Date.parse(b.data?.[field] || b.storedAt) - Date.parse(a.data?.[field] || a.storedAt))[0]?.data || null;
  const profile = latestBy('whoop_profile', 'updatedAt');
  return {
    connected: Boolean(connection),
    user: profile ? { firstName: profile.firstName, lastName: profile.lastName } : null,
    lastSyncedAt: syncState?.last_synced_at || null,
    lastError: syncState?.last_error || null,
    latest: {
      cycle: latestBy('whoop_cycle', 'startedAt'),
      recovery: latestBy('whoop_recovery', 'updatedAt'),
      sleep: byKind('whoop_sleep').filter(record => !record.data?.nap)
        .sort((a, b) => Date.parse(b.data?.endedAt || b.storedAt) - Date.parse(a.data?.endedAt || a.storedAt))[0]?.data || null,
      body: latestBy('whoop_body', 'updatedAt'),
    },
    recentWorkouts: byKind('workout')
      .sort((a, b) => Date.parse(b.data?.startedAt || b.storedAt) - Date.parse(a.data?.startedAt || a.storedAt))
      .slice(0, 10).map(record => record.data),
    capabilities: {
      liveHeartRate: false,
      battery: false,
      bodyMeasurementWrite: false,
      healthKitDirect: false,
      updateMode: 'webhook-and-reconciliation',
    },
  };
}

export async function disconnectWhoopAccount(accountId) {
  const sql = await db();
  try {
    const token = await whoopAccessToken(accountId);
    const response = await fetch(`${API_BASE}/user/access`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 401 && response.status !== 404) console.error('[whoop-revoke]', response.status);
  } catch (error) {
    // Local disconnection must remain possible when WHOOP is unavailable or the
    // grant was already invalidated. The token is removed below in every case.
    console.error('[whoop-revoke]', error.message);
  }
  await sql`DELETE FROM oauth_tokens WHERE account_id = ${accountId} AND provider = ${PROVIDER}`;
  await sql`DELETE FROM oauth_refresh_leases WHERE account_id = ${accountId} AND provider = ${PROVIDER}`;
  await sql`INSERT INTO audit_log (account_id, actor_kind, action) VALUES (${accountId}, 'web', 'whoop_disconnect')`;
}

export function verifyWhoopWebhookSignature(raw, signature, timestamp, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw || '');
  if (!signature || !/^\d{10,16}$/.test(String(timestamp || '')) || !secret) return false;
  const sentAt = Number(timestamp);
  // WHOOP may retry a failed delivery for roughly an hour. A two-hour window
  // accepts legitimate retries while durable trace_id deduplication blocks replay.
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > 2 * 60 * 60_000) return false;
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(String(timestamp)), raw]))
    .digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64'); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function queueWhoopWebhookEvent(event) {
  if (!event || !WEBHOOK_TYPES.has(event.type) || !event.trace_id || event.user_id == null || event.id == null) {
    throw new Error('invalid_whoop_webhook');
  }
  const sql = await db();
  const externalEventID = String(event.trace_id);
  const account = await one(await sql`
    SELECT account_id FROM oauth_tokens
    WHERE provider = ${PROVIDER} AND external_account_id = ${String(event.user_id)}
  `);
  const encrypted = encryptJSON(event, `whoop-event:${externalEventID}`);
  const inserted = await one(await sql`
    INSERT INTO integration_events
      (provider, external_event_id, account_id, event_kind, encrypted_payload)
    VALUES (${PROVIDER}, ${externalEventID}, ${account?.account_id || null},
      ${event.type}, ${JSON.stringify(encrypted)}::jsonb)
    ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id
  `);
  return inserted?.id || null;
}

export async function processWhoopIntegrationEvent(eventID) {
  const sql = await db();
  const row = await one(await sql`
    UPDATE integration_events SET status = 'processing', attempts = attempts + 1, next_attempt_at = now()
    WHERE id = ${eventID} AND provider = ${PROVIDER} AND (
      status IN ('pending', 'retry')
      OR (status = 'processing' AND next_attempt_at < now() - interval '5 minutes')
    )
    RETURNING *
  `);
  if (!row) return;
  try {
    const event = decryptJSON(row.encrypted_payload, `whoop-event:${row.external_event_id}`);
    let accountID = row.account_id;
    if (!accountID) {
      const account = await one(await sql`
        SELECT account_id FROM oauth_tokens
        WHERE provider = ${PROVIDER} AND external_account_id = ${String(event.user_id)}
      `);
      accountID = account?.account_id;
    }
    if (!accountID) throw new Error('unmatched_whoop_user');
    const [resource, aspect] = event.type.split('.');
    const eventSeed = event.trace_id;
    if (aspect === 'deleted') {
      const kind = resource === 'workout' ? 'workout' : `whoop_${resource}`;
      await deleteWhoopRecord(accountID, kind, `whoop:${event.id}`, eventSeed);
    } else {
      const token = await whoopAccessToken(accountID);
      if (resource === 'workout') {
        const record = await whoopFetch(`/activity/workout/${encodeURIComponent(event.id)}`, token);
        await upsertWhoopRecord(accountID, 'workout', `whoop:${event.id}`, mapWhoopWorkout(record), eventSeed);
      } else if (resource === 'sleep') {
        const record = await whoopFetch(`/activity/sleep/${encodeURIComponent(event.id)}`, token);
        await upsertWhoopRecord(accountID, 'whoop_sleep', `whoop:${event.id}`, mapSleep(record), eventSeed);
      } else if (resource === 'recovery') {
        // WHOOP v2 recovery webhooks identify the associated sleep UUID. Resolve
        // that sleep first to obtain the cycle ID required by the recovery endpoint.
        const sleep = await whoopFetch(`/activity/sleep/${encodeURIComponent(event.id)}`, token);
        const record = await whoopFetch(`/cycle/${encodeURIComponent(sleep.cycle_id)}/recovery`, token);
        await upsertWhoopRecord(accountID, 'whoop_recovery', `whoop:${event.id}`, mapRecovery(record), eventSeed);
      }
    }
    await sql`UPDATE integration_events SET status = 'processed', processed_at = now(), last_error = NULL WHERE id = ${eventID}`;
  } catch (error) {
    const ignored = error.message === 'unmatched_whoop_user';
    await sql`
      UPDATE integration_events SET status = ${ignored ? 'ignored' : 'retry'},
        last_error = ${String(error.message).slice(0, 500)},
        next_attempt_at = now() + make_interval(mins => LEAST(240, CAST(power(2, LEAST(attempts, 7)) AS integer)))
      WHERE id = ${eventID}
    `;
    if (!ignored) throw error;
  }
}

export async function reconcileConnectedWhoopAccounts(days = 7) {
  const sql = await db();
  const rows = await sql`SELECT account_id FROM oauth_tokens WHERE provider = ${PROVIDER}`;
  const results = [];
  for (const row of rows) {
    try {
      results.push({ accountID: row.account_id, ok: true, ...(await syncWhoopAccount(row.account_id, { days })) });
    } catch (error) {
      results.push({ accountID: row.account_id, ok: false, error: error.message });
    }
  }
  return results;
}
