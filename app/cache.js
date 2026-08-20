export const SYNC_CACHE_KEY = 'kash_os_sync_snapshot_v1';
export const REMOTE_CACHE_KEY = 'kash_os_remote_cache_v1';

export function emptySyncSnapshot() {
  return { entities: new Map(), revisions: new Map(), cursor: '0' };
}

export function loadSyncSnapshot(storage = globalThis.localStorage) {
  const value = readJSON(storage, SYNC_CACHE_KEY);
  if (!value || !Array.isArray(value.entities) || !Array.isArray(value.revisions)) return emptySyncSnapshot();
  const snapshot = {
    entities: new Map(value.entities),
    revisions: new Map(value.revisions),
    cursor: String(value.cursor || '0'),
  };
  if (snapshot.cursor !== '0' && snapshot.entities.size === 0) snapshot.cursor = '0';
  return snapshot;
}

export function saveSyncSnapshot(snapshot, storage = globalThis.localStorage) {
  return writeJSON(storage, SYNC_CACHE_KEY, {
    cursor: String(snapshot?.cursor || '0'),
    entities: [...(snapshot?.entities || new Map()).entries()],
    revisions: [...(snapshot?.revisions || new Map()).entries()],
  });
}

export function loadRemoteCache(storage = globalThis.localStorage) {
  const value = readJSON(storage, REMOTE_CACHE_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function saveRemoteCache(value, storage = globalThis.localStorage) {
  return writeJSON(storage, REMOTE_CACHE_KEY, value || {});
}

function readJSON(storage, key) {
  try {
    const value = storage?.getItem?.(key);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}

function writeJSON(storage, key, value) {
  try {
    storage?.setItem?.(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}
