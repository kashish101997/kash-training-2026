import test from 'node:test';
import assert from 'node:assert/strict';

test('Health Shortcut capability contract is explicit about web limits', async () => {
  const { default: handler } = await import('../server/handlers/health-shortcut.js');
  let status = 0; let value;
  const req = { method: 'GET', headers: {} };
  const res = { setHeader() {}, status(code) { status = code; return this; }, json(payload) { value = payload; return payload; } };
  await handler(req, res);
  assert.equal(status, 200);
  assert.equal(value.backgroundSync, false);
  assert.equal(value.directHealthKit, false);
  assert.ok(value.supportedTypes.includes('weightKilograms'));
  assert.ok(value.supportedTypes.includes('bloodGlucoseMilligramsPerDeciliter'));
});
