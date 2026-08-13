import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePayload, mergeEntity } from '../lib/merge.js';

test('merges a disjoint stale edit', () => {
  const current = { data: { weight: 80, waist: 90 }, fieldRevisions: { weight: 2, waist: 1 }, fieldProvenance: { weight: 'userEntered', waist: 'pwa' } };
  const result = mergeEntity({ current, incoming: { waist: 89 }, baseVersion: 1, nextRevision: 3, provenance: 'pwa' });
  assert.equal(result.data.weight, 80);
  assert.equal(result.data.waist, 89);
});

test('integration cannot overwrite a newer user field', () => {
  const current = { data: { title: 'My run' }, fieldRevisions: { title: 4 }, fieldProvenance: { title: 'userEntered' } };
  const result = mergeEntity({ current, incoming: { title: 'Morning Run' }, baseVersion: 2, nextRevision: 5, provenance: 'strava' });
  assert.equal(result.data.title, 'My run');
  assert.deepEqual(result.conflicts, [{ field: 'title', kept: 'userEntered', rejected: 'strava' }]);
});

test('latest accepted user edit wins a same-field conflict', () => {
  const current = { data: { note: 'old' }, fieldRevisions: { note: 4 }, fieldProvenance: { note: 'userEntered' } };
  const result = mergeEntity({ current, incoming: { note: 'new' }, baseVersion: 2, nextRevision: 5, provenance: 'userEntered' });
  assert.equal(result.data.note, 'new');
});

test('a newer WHOOP webhook may update an earlier WHOOP field', () => {
  const current = { data: { recoveryScore: 72 }, fieldRevisions: { recoveryScore: 3 }, fieldProvenance: { recoveryScore: 'whoop' } };
  const result = mergeEntity({ current, incoming: { recoveryScore: 76 }, baseVersion: 0, nextRevision: 4, provenance: 'whoop' });
  assert.equal(result.data.recoveryScore, 76);
  assert.deepEqual(result.conflicts, []);
});

test('WHOOP cannot overwrite a user-entered field', () => {
  const current = { data: { title: 'Intervals' }, fieldRevisions: { title: 5 }, fieldProvenance: { title: 'userEntered' } };
  const result = mergeEntity({ current, incoming: { title: 'Running' }, baseVersion: 0, nextRevision: 6, provenance: 'whoop' });
  assert.equal(result.data.title, 'Intervals');
});

test('rejects local-only data at the server sync boundary, including nested values', () => {
  const payload = Buffer.from(JSON.stringify({ title: 'Run', details: { routeFileName: 'secret.gpx' } })).toString('base64');
  assert.throws(() => decodePayload(payload), /private_field_not_syncable/);
});
