/* Kash Strap single-user web sync client.
 * This client synchronizes summary/log entities and never accepts routes, ECG,
 * or raw-frame fields. The public app URL maps to one internal Kash account.
 */
(function () {
  'use strict';
  const CURSOR_KEY = 'kash_private_sync_cursor_v1';
  const REVISIONS_KEY = 'kash_private_sync_revisions_v1';
  const HASHES_KEY = 'kash_private_sync_hashes_v1';
  const PENDING_KEY = 'kash_private_sync_pending_v1';
  const SAFE_ARRAYS = [
    'weights', 'workouts', 'injuries', 'meals', 'foodLog', 'bloodSugar', 'raceResults',
    'gatewaySessions', 'hyroxSessions', 'strengthPRs', 'measurements', 'hyroxLadderEntries',
    'practice_template', 'practice_completion'
  ];
  let timer = null;
  let syncReady = false;
  const FORBIDDEN_KEYS = new Set([
    'route', 'routefilename', 'locations', 'location', 'latitude', 'longitude', 'coordinates',
    'gpx', 'ecg', 'rawframe', 'rawframes', 'imu', 'optical', 'rrintervals', 'heartratesamples',
    'highfrequencysamples', 'healthkituuid', 'deviceid', 'serialnumber', 'hardwarerevision'
  ]);

  function sanitizeForSync(value) {
    if (Array.isArray(value)) return value.map(sanitizeForSync);
    if (!value || typeof value !== 'object') return value;
    const safe = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!FORBIDDEN_KEYS.has(normalized)) safe[key] = sanitizeForSync(child);
    }
    return safe;
  }

  async function contentHash(value) {
    const bytes = new TextEncoder().encode(stableJSON(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function stableJSON(value) {
    if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function preparePayload(syncKind, original) {
    const record = sanitizeForSync(original);
    delete record._syncID;
    delete record._syncKind;
    if (syncKind === 'workout') {
      record.title = original.name || record.title;
      record.modality = original.type || record.modality;
      if (original.distance != null) record.distanceMeters = Number(original.distance) * 1000;
      if (original.duration != null) record.movingSeconds = Math.round(Number(original.duration) * 60);
      if (original.hr != null) record.averageHeartRate = Number(original.hr);
      delete record.date; delete record.name; delete record.type; delete record.distance;
      delete record.duration; delete record.hr; delete record.completed;
    } else if (syncKind === 'body_measurement') {
      if (original.weight != null) record.weightKilograms = Number(original.weight);
      if (original.waist != null) record.waistCentimeters = Number(original.waist);
      if (original.hip != null) record.hipCentimeters = Number(original.hip);
      if (original.chest != null) record.chestCentimeters = Number(original.chest);
      delete record.date; delete record.weight; delete record.waist; delete record.hip; delete record.chest;
    }
    return record;
  }

  function localArrayFor(syncKind) {
    if (syncKind === 'workout') return 'workouts';
    if (syncKind === 'body_measurement') return 'measurements';
    return SAFE_ARRAYS.includes(syncKind) ? syncKind : null;
  }

  function b64Encode(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function b64Decode(value) {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function stableID(kind, record) {
    if (record._syncID) return String(record._syncID);
    if (record.id || record.uuid || record.raceId) return String(record.id || record.uuid || record.raceId);
    const identity = {
      date: record.date || record.startedAt || record.timestamp || null,
      time: record.time || null,
      name: record.name || record.title || record.lift || record.area || record.station || null,
      source: record.source || null,
    };
    const canonical = stableJSON(identity);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}:${canonical}`));
    return Array.from(new Uint8Array(digest)).slice(0, 16).map(v => v.toString(16).padStart(2, '0')).join('');
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function adaptChange(change) {
    const key = localArrayFor(change.kind);
    if (change.tombstone) return key ? { key, value: { _syncID: change.entityID, _syncKind: change.kind } } : null;
    if (!change.payloadBase64) return null;
    const value = b64Decode(change.payloadBase64);
    value._syncID = change.entityID;
    value._syncKind = change.kind;
    if (change.kind === 'workout' && value.startedAt) {
      return { key: 'workouts', value: {
        ...value,
        _syncID: change.entityID,
        _syncKind: change.kind,
        date: value.startedAt.slice(0, 10), name: value.title || 'Kash Strap workout',
        completed: true, type: value.modality || 'other',
        distance: value.distanceMeters == null ? null : +(value.distanceMeters / 1000).toFixed(2),
        duration: value.movingSeconds == null ? null : Math.round(value.movingSeconds / 60),
        hr: value.averageHeartRate || null, source: value.source || 'kashstrap'
      }};
    }
    if (change.kind === 'body_measurement') {
      return { key: 'measurements', value: {
        ...value, _syncID: change.entityID, _syncKind: change.kind,
        date: (value.timestamp || change.updatedAt || '').slice(0, 10),
        weight: value.weightKilograms, waist: value.waistCentimeters,
        hip: value.hipCentimeters, chest: value.chestCentimeters,
        source: value.source || 'kashstrap'
      }};
    }
    return SAFE_ARRAYS.includes(change.kind) ? { key: change.kind, value } : null;
  }

  async function pullLegacyState() {
    let cursor = localStorage.getItem(CURSOR_KEY) || '0';
    const merged = { lastUpdated: new Date().toISOString(), _tombstones: [] };
    const revisions = JSON.parse(localStorage.getItem(REVISIONS_KEY) || '{}');
    const hashes = JSON.parse(localStorage.getItem(HASHES_KEY) || '{}');
    do {
      const page = await api(`/api/sync/pull?cursor=${encodeURIComponent(cursor)}`);
      for (const change of page.changes || []) {
        revisions[`${change.kind}:${change.entityID}`] = change.revision;
        const adapted = adaptChange(change);
        if (!adapted) continue;
        const revisionKey = `${change.kind}:${change.entityID}`;
        if (change.tombstone) {
          merged._tombstones.push({ key: adapted.key, entityID: change.entityID, syncKind: change.kind });
          hashes[revisionKey] = '__tombstone__';
          continue;
        }
        merged[adapted.key] ||= [];
        merged[adapted.key] = merged[adapted.key].filter(value => value._syncID !== change.entityID);
        merged[adapted.key].push(adapted.value);
        hashes[revisionKey] = await contentHash(preparePayload(change.kind, adapted.value));
      }
      cursor = page.cursor || cursor;
      if (!page.hasMore) break;
    } while (true);
    localStorage.setItem(CURSOR_KEY, cursor);
    localStorage.setItem(REVISIONS_KEY, JSON.stringify(revisions));
    localStorage.setItem(HASHES_KEY, JSON.stringify(hashes));
    syncReady = true;
    setStatus('Private sync active');
    return merged;
  }

  async function pushLegacyState(state) {
    const revisions = JSON.parse(localStorage.getItem(REVISIONS_KEY) || '{}');
    const hashes = JSON.parse(localStorage.getItem(HASHES_KEY) || '{}');
    let pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    if (pending.length) await flushPending(pending, revisions, hashes);
    pending = [];
    const present = new Set();
    for (const kind of SAFE_ARRAYS) {
      for (const original of state[kind] || []) {
        const syncKind = original._syncKind || kind;
        const record = preparePayload(syncKind, original);
        const entityID = original._syncID || await stableID(syncKind, record);
        const revisionKey = `${syncKind}:${entityID}`;
        present.add(revisionKey);
        const hash = await contentHash(record);
        if (hashes[revisionKey] === hash) continue;
        pending.push({ hashKey: revisionKey, hashValue: hash, mutation: {
          mutationID: crypto.randomUUID(), entityID, kind: syncKind,
          baseVersion: revisions[revisionKey] || 0,
          tombstone: false, provenance: 'userEntered', payloadBase64: b64Encode(record)
        }});
      }
    }
    for (const revisionKey of Object.keys(revisions)) {
      const separator = revisionKey.indexOf(':');
      const syncKind = revisionKey.slice(0, separator);
      const entityID = revisionKey.slice(separator + 1);
      if (!localArrayFor(syncKind) || present.has(revisionKey) || hashes[revisionKey] === '__tombstone__') continue;
      pending.push({ hashKey: revisionKey, hashValue: '__tombstone__', mutation: {
        mutationID: crypto.randomUUID(), entityID, kind: syncKind,
        baseVersion: revisions[revisionKey] || 0, tombstone: true,
        provenance: 'userEntered', payloadBase64: null
      }});
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    await flushPending(pending, revisions, hashes);
    setStatus('Private sync active');
  }

  async function flushPending(pending, revisions, hashes) {
    while (pending.length) {
      const batch = pending.slice(0, 100);
      const response = await api('/api/sync/push', {
        method: 'POST', body: JSON.stringify({ mutations: batch.map(item => item.mutation) })
      });
      for (const result of response.results || []) {
        revisions[`${result.kind}:${result.entityID}`] = result.revision;
      }
      for (const item of batch) hashes[item.hashKey] = item.hashValue;
      pending.splice(0, batch.length);
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      localStorage.setItem(REVISIONS_KEY, JSON.stringify(revisions));
      localStorage.setItem(HASHES_KEY, JSON.stringify(hashes));
    }
  }

  function schedulePush(state) {
    if (!syncReady) return;
    clearTimeout(timer);
    timer = setTimeout(() => pushLegacyState(state).catch(error => {
      setStatus('Private sync offline');
    }), 1200);
  }

  function setStatus(text) {
    const node = document.getElementById('kash-private-sync-status');
    if (node) node.textContent = text;
  }

  function installControls() {
    if (document.getElementById('kash-private-sync-controls')) return;
    const panel = document.createElement('div');
    panel.id = 'kash-private-sync-controls';
    panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;padding:10px 12px;border-radius:12px;background:#111d;border:1px solid #ffffff22;color:#fff;font:12px system-ui;display:flex;gap:8px;align-items:center';
    panel.innerHTML = '<span id="kash-private-sync-status">Private web sync</span><button type="button" data-action="sync">Sync now</button>';
    panel.addEventListener('click', async event => {
      const action = event.target?.dataset?.action;
      try {
        if (action === 'sync') {
          setStatus('Syncing…');
          if (typeof AppState !== 'undefined' && AppState.loadRemote) await AppState.loadRemote();
          else location.reload();
        }
      } catch (error) { setStatus(error.message); }
    });
    document.body.appendChild(panel);
  }

  window.KashSync = { pullLegacyState, pushLegacyState, schedulePush };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installControls);
  else installControls();
})();
