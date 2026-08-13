import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { db, one } from '../lib/db.js';
import { applyMutation } from '../lib/sync-store.js';

const arrays = ['weights','workouts','foodLog','injuries','raceResults','bloodSugar','gatewaySessions','hyroxSessions','strengthPRs','measurements'];
const data = JSON.parse(fs.readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
const sql = await db();
const account = await one(await sql`INSERT INTO accounts (handle) VALUES ('kash') ON CONFLICT (handle) DO UPDATE SET handle = excluded.handle RETURNING id`);
let imported = 0;
for (const kind of arrays) {
  for (const record of data[kind] || []) {
    const key = record.id || record.uuid || record.raceId || createHash('sha256').update(`${kind}:${JSON.stringify(record)}`).digest('hex').slice(0, 32);
    const hash = createHash('sha256').update(`migration:${kind}:${key}`).digest('hex');
    const mutationID = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    await applyMutation(account.id, 'migration', {
      mutationID, entityID: String(key), kind, baseVersion: 0, tombstone: false,
      provenance: record.source === 'strava' ? 'strava' : 'pwa',
      payloadBase64: Buffer.from(JSON.stringify(record)).toString('base64'),
    });
    imported++;
  }
}
console.log(`Imported ${imported} records into encrypted private sync.`);
console.log('data.json was not modified. Verify the private PWA before manually replacing the public fallback.');

