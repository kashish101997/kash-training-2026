const PRECEDENCE = { computed: 1, strava: 2, whoop: 2, healthKit: 3, pwa: 4, userEntered: 5 };
const FORBIDDEN_SYNC_KEYS = new Set([
  'route', 'routefilename', 'locations', 'location', 'latitude', 'longitude', 'coordinates',
  'gpx', 'ecg', 'rawframe', 'rawframes', 'imu', 'optical', 'rrintervals', 'heartratesamples',
  'highfrequencysamples', 'healthkituuid', 'deviceid', 'serialnumber', 'hardwarerevision',
]);

export function decodePayload(payloadBase64) {
  if (!payloadBase64) return {};
  const data = Buffer.from(payloadBase64, 'base64');
  if (data.length > 512_000) throw new Error('payload_too_large');
  const value = JSON.parse(data.toString('utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('payload_must_be_object');
  assertSyncSafePayload(value);
  return value;
}

export function assertSyncSafePayload(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSyncSafePayload(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_SYNC_KEYS.has(normalized)) throw new Error(`private_field_not_syncable:${path}.${key}`);
    assertSyncSafePayload(child, `${path}.${key}`);
  }
}

export function encodePayload(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function mergeEntity({ current, incoming, baseVersion, nextRevision, provenance }) {
  const currentData = current?.data || {};
  const fieldRevisions = { ...(current?.fieldRevisions || {}) };
  const fieldProvenance = { ...(current?.fieldProvenance || {}) };
  const merged = { ...currentData };
  const conflicts = [];

  for (const [field, value] of Object.entries(incoming)) {
    const changedAfterBase = (fieldRevisions[field] || 0) > baseVersion;
    const existingSource = fieldProvenance[field] || 'computed';
    const incomingRank = PRECEDENCE[provenance] || 0;
    const existingRank = PRECEDENCE[existingSource] || 0;
    const accept = !changedAfterBase || incomingRank > existingRank || existingSource === provenance
      || (incomingRank === existingRank && provenance === 'userEntered');
    if (accept) {
      merged[field] = value;
      fieldRevisions[field] = nextRevision;
      fieldProvenance[field] = provenance;
    } else {
      conflicts.push({ field, kept: existingSource, rejected: provenance });
    }
  }

  return { data: merged, fieldRevisions, fieldProvenance, conflicts };
}
