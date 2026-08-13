import { createHash } from 'node:crypto';
import { db, one } from './db.js';
import { decryptJSON, encryptJSON, randomToken, sha256 } from './crypto.js';
import { applyMutation } from './sync-store.js';

const PROVIDER = 'strava';
const TYPE_MAP = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run',
  Walk: 'walk', Hike: 'walk', Ride: 'cycle', VirtualRide: 'cycle',
  Workout: 'other', WeightTraining: 'strength', Crossfit: 'hyrox',
};

const tokenAAD = accountId => `${accountId}:oauth:${PROVIDER}`;

export async function createAuthorization(accountId) {
  const state = randomToken();
  const sql = await db();
  await sql`
    INSERT INTO integration_oauth_states (state_hash, account_id, expires_at, provider)
    VALUES (${sha256(state)}, ${accountId}, now() + interval '10 minutes', ${PROVIDER})
  `;
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID || '',
    redirect_uri: `${process.env.PUBLIC_APP_URL}/api/strava/callback`,
    response_type: 'code', approval_prompt: 'auto',
    scope: 'read,activity:read_all,activity:write', state,
  }).toString();
  return url;
}
export async function consumeOAuthState(state) {
  const sql = await db();
  return one(await sql`
    UPDATE integration_oauth_states SET consumed_at = now()
    WHERE state_hash = ${sha256(state)} AND provider = ${PROVIDER}
      AND consumed_at IS NULL AND expires_at > now()
    RETURNING account_id
  `);
}

export async function exchangeAuthorizationCode(accountId, code) {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new Error(`strava_oauth_${response.status}`);
  const tokens = await response.json();
  await storeTokens(accountId, tokens);
  return tokens.athlete;
}

async function storeTokens(accountId, tokens) {
  const sql = await db();
  const athleteID = String(tokens.athlete?.id || tokens.athlete_id || '');
  const encrypted = encryptJSON({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
    scope: tokens.scope || 'read,activity:read_all,activity:write',
  }, tokenAAD(accountId));
  await sql`
    INSERT INTO oauth_tokens (account_id, provider, external_account_id, encrypted_payload, updated_at)
    VALUES (${accountId}, ${PROVIDER}, ${athleteID}, ${JSON.stringify(encrypted)}::jsonb, now())
    ON CONFLICT (account_id, provider) DO UPDATE SET
      external_account_id = excluded.external_account_id,
      encrypted_payload = excluded.encrypted_payload,
      updated_at = now()
  `;
}

export async function accessToken(accountId) {
  const sql = await db();
  const row = await one(await sql`
    SELECT external_account_id, encrypted_payload FROM oauth_tokens
    WHERE account_id = ${accountId} AND provider = ${PROVIDER}
  `);
  if (!row) throw new Error('strava_not_connected');
  let tokens = decryptJSON(row.encrypted_payload, tokenAAD(accountId));
  if (Number(tokens.expiresAt) > Math.floor(Date.now() / 1000) + 120) return tokens.accessToken;
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }),
  });
  if (!response.ok) throw new Error(`strava_refresh_${response.status}`);
  const rotated = await response.json();
  await storeTokens(accountId, { ...rotated, athlete_id: row.external_account_id });
  return rotated.access_token;
}

export async function getActivity(accountId, activityId) {
  const token = await accessToken(accountId);
  const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`strava_activity_${response.status}`);
  return response.json();
}

export function mapActivity(activity) {
  const modality = TYPE_MAP[activity.sport_type || activity.type];
  if (!modality) return null;
  return {
    id: `strava:${activity.id}`,
    startedAt: activity.start_date,
    endedAt: activity.start_date && activity.elapsed_time
      ? new Date(new Date(activity.start_date).getTime() + activity.elapsed_time * 1000).toISOString()
      : null,
    modality,
    title: activity.name || 'Strava activity',
    distanceMeters: activity.distance || null,
    movingSeconds: activity.moving_time || null,
    averageHeartRate: activity.average_heartrate || null,
    maxHeartRate: activity.max_heartrate || null,
    source: 'strava',
    externalIDs: { strava: String(activity.id) },
  };
}

export async function queueWebhookEvent(event) {
  const sql = await db();
  const eventKey = `${event.subscription_id}:${event.object_type}:${event.object_id}:${event.aspect_type}:${event.event_time}`;
  const externalEventID = createHash('sha256').update(eventKey).digest('hex');
  const account = await one(await sql`
    SELECT account_id FROM oauth_tokens
    WHERE provider = ${PROVIDER} AND external_account_id = ${String(event.owner_id)}
  `);
  const encrypted = encryptJSON(event, `strava-event:${externalEventID}`);
  const inserted = await one(await sql`
    INSERT INTO integration_events
      (provider, external_event_id, account_id, event_kind, encrypted_payload)
    VALUES (${PROVIDER}, ${externalEventID}, ${account?.account_id || null},
      ${`${event.object_type}:${event.aspect_type}`}, ${JSON.stringify(encrypted)}::jsonb)
    ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id
  `);
  return inserted?.id || null;
}

export async function processIntegrationEvent(eventID) {
  const sql = await db();
  const row = await one(await sql`
    UPDATE integration_events SET status = 'processing', attempts = attempts + 1, next_attempt_at = now()
    WHERE id = ${eventID} AND (
      status IN ('pending', 'retry')
      OR (status = 'processing' AND next_attempt_at < now() - interval '5 minutes')
    )
    RETURNING *
  `);
  if (!row) return;
  try {
    const event = decryptJSON(row.encrypted_payload, `strava-event:${row.external_event_id}`);
    let accountID = row.account_id;
    if (!accountID) {
      const account = await one(await sql`
        SELECT account_id FROM oauth_tokens
        WHERE provider = ${PROVIDER} AND external_account_id = ${String(event.owner_id)}
      `);
      accountID = account?.account_id;
    }
    if (!accountID || event.object_type !== 'activity') throw new Error('ignored_or_unmatched_event');
    const entityID = `strava:${event.object_id}`;
    const mutationID = deterministicUUID(`strava:${row.external_event_id}`);
    if (event.aspect_type === 'delete') {
      await applyMutation(accountID, 'strava', {
        mutationID, entityID, kind: 'workout', baseVersion: 0,
        tombstone: true, provenance: 'strava',
      });
    } else {
      const activity = await getActivity(accountID, event.object_id);
      const workout = mapActivity(activity);
      if (!workout) throw new Error('unsupported_activity_type');
      await applyMutation(accountID, 'strava', {
        mutationID, entityID, kind: 'workout', baseVersion: 0,
        tombstone: false, provenance: 'strava',
        payloadBase64: Buffer.from(JSON.stringify(workout)).toString('base64'),
      });
    }
    await sql`UPDATE integration_events SET status = 'processed', processed_at = now(), last_error = NULL WHERE id = ${eventID}`;
  } catch (error) {
    const ignored = ['ignored_or_unmatched_event', 'unsupported_activity_type'].includes(error.message);
    await sql`
      UPDATE integration_events SET status = ${ignored ? 'ignored' : 'retry'},
        last_error = ${String(error.message).slice(0, 500)},
        next_attempt_at = now() + make_interval(mins => LEAST(240, CAST(power(2, LEAST(attempts, 7)) AS integer)))
      WHERE id = ${eventID}
    `;
    if (!ignored) throw error;
  }
}

export async function uploadApprovedWorkout(accountId, workout) {
  const token = await accessToken(accountId);
  const isStrength = ['strength', 'hyrox', 'bowling'].includes(workout.modality);
  let response;
  if (isStrength) {
    response = await fetch('https://www.strava.com/api/v3/activities', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: workout.title,
        sport_type: workout.modality === 'strength' ? 'WeightTraining' : 'Workout',
        start_date_local: workout.startedAt,
        elapsed_time: workout.movingSeconds || 1,
        description: 'Shared from Kash OS with explicit approval',
      }),
    });
  } else {
    const tcx = workoutToTCX(workout);
    const form = new FormData();
    form.append('data_type', 'tcx');
    form.append('external_id', `kashstrap-${workout.id}`);
    form.append('name', workout.title || 'Kash OS workout');
    form.append('file', new Blob([tcx], { type: 'application/vnd.garmin.tcx+xml' }), `${workout.id}.tcx`);
    response = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
  }
  if (!response.ok) throw new Error(`strava_upload_${response.status}:${await response.text()}`);
  return response.json();
}

export function workoutToTCX(workout) {
  const start = new Date(workout.startedAt).toISOString();
  const seconds = Math.max(1, Number(workout.movingSeconds || 1));
  const distance = Math.max(0, Number(workout.distanceMeters || 0));
  const sport = workout.modality === 'cycle' ? 'Biking' : 'Running';
  return `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="${sport}"><Id>${start}</Id><Lap StartTime="${start}"><TotalTimeSeconds>${seconds}</TotalTimeSeconds><DistanceMeters>${distance}</DistanceMeters><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod></Lap></Activity></Activities></TrainingCenterDatabase>`;
}

function deterministicUUID(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}
