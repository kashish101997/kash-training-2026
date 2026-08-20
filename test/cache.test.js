import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySyncSnapshot, loadRemoteCache, loadSyncSnapshot, saveRemoteCache, saveSyncSnapshot } from '../app/cache.js';
import { classifyAPIError, pullAllChanges } from '../app/services.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('sync snapshot preserves entities, revisions, and the incremental cursor', () => {
  const storage = memoryStorage();
  const snapshot = emptySyncSnapshot();
  snapshot.cursor = '42';
  snapshot.entities.set('workout:one', { id: 'one', kind: 'workout', revision: 3, data: { title: 'Run' } });
  snapshot.revisions.set('workout:one', 3);
  assert.equal(saveSyncSnapshot(snapshot, storage), true);
  const restored = loadSyncSnapshot(storage);
  assert.equal(restored.cursor, '42');
  assert.equal(restored.entities.get('workout:one').data.title, 'Run');
  assert.equal(restored.revisions.get('workout:one'), 3);
});

test('a cursor without cached entities is discarded to prevent a partial snapshot', () => {
  const storage = memoryStorage();
  storage.setItem('kash_os_sync_snapshot_v1', JSON.stringify({ cursor: '99', entities: [], revisions: [] }));
  assert.equal(loadSyncSnapshot(storage).cursor, '0');
});

test('remote dashboard cache round trips without throwing when storage is unavailable', () => {
  const storage = memoryStorage();
  assert.equal(saveRemoteCache({ whoop: { connected: true }, quotaBackoffUntil: 123 }, storage), true);
  assert.equal(loadRemoteCache(storage).whoop.connected, true);
  assert.equal(saveRemoteCache({}, { setItem() { throw new Error('quota'); } }), false);
});

test('change pulls continue from the saved cursor and retain prior entities', async () => {
  const previousFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async url => {
    requested.push(String(url));
    const payloadBase64 = Buffer.from(JSON.stringify({ title: 'Intervals' })).toString('base64');
    return new Response(JSON.stringify({
      cursor: '43', hasMore: false,
      changes: [{ entityID: 'two', kind: 'workout', revision: 1, payloadBase64 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const previous = emptySyncSnapshot();
    previous.cursor = '42';
    previous.entities.set('workout:one', { id: 'one', kind: 'workout', revision: 3, data: { title: 'Run' } });
    const result = await pullAllChanges(previous);
    assert.match(requested[0], /cursor=42/);
    assert.equal(result.cursor, '43');
    assert.equal(result.entities.size, 2);
    assert.equal(result.entities.get('workout:two').data.title, 'Intervals');
  } finally { globalThis.fetch = previousFetch; }
});

test('Neon transfer quota errors become a stable retryable app state', () => {
  const result = classifyAPIError('Server error (HTTP status 402): Your project has exceeded the data transfer quota.', 400);
  assert.equal(result.code, 'database_quota_exceeded');
  assert.equal(result.status, 503);
  assert.match(result.message, /Saved data remains available/);
});
