import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptJSON, encryptJSON } from '../lib/crypto.js';

test('AES-256-GCM envelope round trips and binds AAD', () => {
  process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const encrypted = encryptJSON({ weight: 80 }, 'account:measurement:id');
  assert.deepEqual(decryptJSON(encrypted, 'account:measurement:id'), { weight: 80 });
  assert.throws(() => decryptJSON(encrypted, 'different'));
});

