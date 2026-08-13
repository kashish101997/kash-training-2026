import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function sha256(value) { return createHash('sha256').update(value).digest(); }
export function randomToken(bytes = 32) { return randomBytes(bytes).toString('base64url'); }

function encryptionKey() {
  const configured = process.env.DATA_ENCRYPTION_KEY || '';
  let key;
  try { key = Buffer.from(configured, 'base64'); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return key;
}

export function encryptJSON(value, aad = '') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), data: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptJSON(envelope, aad = '') {
  if (!envelope || envelope.v !== 1) throw new Error('Unsupported encrypted payload version');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.iv, 'base64'));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

