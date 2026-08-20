const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...options,
    headers: { ...JSON_HEADERS, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = classifyAPIError(payload.error || `HTTP ${response.status}`, response.status);
    const error = new Error(details.message);
    error.code = details.code;
    error.status = details.status;
    error.retryAfter = payload.retryAfter;
    throw error;
  }
  return payload;
}

export function classifyAPIError(message, status = 500) {
  if (/data transfer quota|exceeded.+quota|HTTP status 402/i.test(String(message || ''))) {
    return {
      code: 'database_quota_exceeded',
      status: 503,
      message: 'Cloud sync is paused because the database transfer allowance is used. Saved data remains available.',
    };
  }
  return { code: 'api_error', status, message: String(message || `HTTP ${status}`) };
}

function decodeBase64JSON(value) {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function encodeBase64JSON(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export async function pullAllChanges(previous = null) {
  let cursor = String(previous?.cursor || '0');
  const entities = new Map(previous?.entities || []);
  const revisions = new Map(previous?.revisions || []);
  do {
    const page = await api(`/api/sync/pull?cursor=${encodeURIComponent(cursor)}`);
    for (const change of page.changes || []) {
      const key = `${change.kind}:${change.entityID}`;
      revisions.set(key, Number(change.revision || 0));
      if (change.tombstone) entities.delete(key);
      else if (change.payloadBase64) entities.set(key, {
        id: change.entityID,
        kind: change.kind,
        revision: Number(change.revision || 0),
        provenance: change.provenance,
        updatedAt: change.updatedAt,
        data: decodeBase64JSON(change.payloadBase64),
      });
    }
    cursor = page.cursor || cursor;
    if (!page.hasMore) break;
  } while (true);
  return { entities, revisions, cursor };
}

export async function pushEntity(kind, entityID, data, baseVersion = 0, provenance = 'pwa') {
  const mutation = {
    mutationID: crypto.randomUUID(),
    entityID,
    kind,
    baseVersion,
    tombstone: false,
    provenance,
    payloadBase64: encodeBase64JSON(data),
  };
  const response = await api('/api/sync/push', { method: 'POST', body: JSON.stringify({ mutations: [mutation] }) });
  return response.results?.[0] || null;
}

export async function deleteEntity(kind, entityID, baseVersion = 0) {
  const mutation = {
    mutationID: crypto.randomUUID(), entityID, kind, baseVersion,
    tombstone: true, provenance: 'userEntered', payloadBase64: null,
  };
  return api('/api/sync/push', { method: 'POST', body: JSON.stringify({ mutations: [mutation] }) });
}

export const Whoop = {
  status: () => api('/api/whoop/status'),
  sync: days => api('/api/whoop/sync', { method: 'POST', body: JSON.stringify({ days }) }),
  disconnect: () => api('/api/whoop/disconnect', { method: 'POST', body: '{}' }),
  connectURL: '/api/whoop/connect',
};

export const Strava = {
  status: () => api('/api/strava/status'),
  disconnect: () => api('/api/strava/disconnect', { method: 'POST', body: '{}' }),
  connectURL: '/api/strava/connect',
};

export const Training = {
  catalog: (summary = false) => api(`/api/training/catalog${summary ? '?summary=1' : ''}`),
  enroll: (planID, active, startDate = null) => api('/api/training/enrollment', {
    method: 'POST', body: JSON.stringify({ planID, active, startDate }),
  }),
};

export const HealthShortcut = {
  status: () => api('/api/health/shortcut'),
  setupURL: '/docs/KASH_OS_HEALTH_SHORTCUT.md',
  runWrite(measurement) {
    const bytes = new TextEncoder().encode(JSON.stringify({ action: 'write', measurement }));
    let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    const input = btoa(binary);
    location.href = `shortcuts://run-shortcut?name=${encodeURIComponent('Kash OS Health Sync')}&input=text&text=${encodeURIComponent(input)}`;
  },
};

export const PushReminders = {
  config: () => api('/api/push/subscription'),
  subscribe: input => api('/api/push/subscription', { method: 'POST', body: JSON.stringify(input) }),
};

export function entitiesOf(snapshot, kind) {
  return [...snapshot.entities.values()].filter(entity => entity.kind === kind);
}

export function entityRevision(snapshot, kind, id) {
  return snapshot.revisions.get(`${kind}:${id}`) || 0;
}
