import { createHash, timingSafeEqual } from 'node:crypto';
import { requireAuth } from '../../lib/auth.js';
import { body, json, method } from '../../lib/http.js';
import { encodePayload } from '../../lib/merge.js';
import { applyMutation } from '../../lib/sync-store.js';

const BODY_FIELDS = new Set([
  'weightKilograms', 'bodyFatPercentage', 'leanMassKilograms', 'bmi',
  'waistCentimeters', 'heightMeters',
]);

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET') {
      return json(res, 200, {
        available: true,
        tokenRequired: Boolean(process.env.HEALTH_SHORTCUT_TOKEN),
        supportedTypes: [...BODY_FIELDS, 'bloodGlucoseMilligramsPerDeciliter'],
        backgroundSync: false,
        directHealthKit: false,
      });
    }
    assertShortcutAccess(req);
    const auth = await requireAuth(req);
    const input = body(req);
    const samples = Array.isArray(input.samples) ? input.samples : [input.sample || input];
    if (!samples.length || samples.length > 50) throw new Error('invalid_health_sample_batch');
    const results = [];
    for (const sample of samples) {
      const normalized = normalizeSample(sample);
      const mutationID = deterministicUUID(`health:${normalized.sampleUUID}`);
      results.push(await applyMutation(auth.account_id, 'healthKit', {
        mutationID,
        entityID: normalized.entityID,
        kind: normalized.kind,
        baseVersion: Math.max(0, Number(sample.baseVersion || 0)),
        tombstone: false,
        provenance: 'healthKit',
        payloadBase64: encodePayload(normalized.data),
      }));
    }
    return json(res, 200, { imported: results.length, results });
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}

function normalizeSample(sample) {
  if (!sample || typeof sample !== 'object') throw new Error('invalid_health_sample');
  const sampleUUID = String(sample.healthKitUUID || sample.uuid || '').trim();
  if (!/^[a-z0-9._:-]{8,200}$/i.test(sampleUUID)) throw new Error('invalid_health_sample_uuid');
  const timestamp = new Date(sample.timestamp || sample.startDate || Date.now());
  if (!Number.isFinite(timestamp.getTime())) throw new Error('invalid_health_sample_timestamp');
  const type = String(sample.type || 'body_measurement');
  if (type === 'blood_glucose' || sample.bloodGlucoseMilligramsPerDeciliter != null) {
    const value = numeric(sample.bloodGlucoseMilligramsPerDeciliter ?? sample.value);
    if (value == null || value <= 0 || value > 1000) throw new Error('invalid_blood_glucose');
    return {
      sampleUUID,
      entityID: `healthkit:${sampleUUID}`,
      kind: 'bloodSugar',
      data: { id: `healthkit:${sampleUUID}`, healthKitUUID: sampleUUID, timestamp: timestamp.toISOString(), value, unit: 'mg/dL', context: sample.context || null, source: 'healthKit', provenance: 'healthKit' },
    };
  }
  const data = { id: `healthkit:${sampleUUID}`, healthKitUUID: sampleUUID, timestamp: timestamp.toISOString(), source: 'healthKit', provenance: 'healthKit' };
  for (const field of BODY_FIELDS) {
    const value = numeric(sample[field]);
    if (value != null) data[field] = value;
  }
  if (Object.keys(data).length <= 5) throw new Error('health_sample_has_no_supported_values');
  return { sampleUUID, entityID: `healthkit:${sampleUUID}`, kind: 'body_measurement', data };
}

function assertShortcutAccess(req) {
  const expected = process.env.HEALTH_SHORTCUT_TOKEN;
  if (!expected) return;
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
    const error = new Error('invalid_health_shortcut_token'); error.status = 401; throw error;
  }
}

function numeric(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deterministicUUID(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = (parseInt(hex[16], 16) & 3 | 8).toString(16);
  const value = hex.join('');
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
