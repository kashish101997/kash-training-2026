import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, one } from '../lib/db.js';
import { encodePayload } from '../lib/merge.js';
import { applyMutation } from '../lib/sync-store.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.DATA_ENCRYPTION_KEY) throw new Error('DATA_ENCRYPTION_KEY is required');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.TRAINING_CATALOG_PATH,
  path.join(root, 'PrivateTrainingContent/TrainingCatalog.generated.json'),
  path.join(root, 'ios/KashStrap/PrivateTrainingContent/TrainingCatalog.generated.json'),
].filter(Boolean);
const sourcePath = candidates.find(candidate => fs.existsSync(candidate));
if (!sourcePath) throw new Error('Generate PrivateTrainingContent/TrainingCatalog.generated.json first');
const catalog = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
if (!Array.isArray(catalog.plans) || !catalog.plans.length) throw new Error('training_catalog_has_no_plans');
const requestedPlanID = String(process.env.TRAINING_PLAN_ID || '').trim();
const plans = requestedPlanID
  ? catalog.plans.filter(plan => String(plan.id) === requestedPlanID)
  : catalog.plans;
if (!plans.length) throw new Error(`training_plan_not_found:${requestedPlanID}`);

function deterministicUUID(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
}

const sql = await db();
const account = await one(await sql`
  INSERT INTO accounts (handle) VALUES ('kash')
  ON CONFLICT (handle) DO UPDATE SET handle = excluded.handle
  RETURNING id
`);
let sessions = 0;
for (const plan of plans) {
  const payload = { schemaVersion: catalog.schemaVersion, catalogGeneratedAt: catalog.generatedAt, plan };
  const encoded = encodePayload(payload);
  if (Buffer.from(encoded, 'base64').length > 512_000) throw new Error(`plan_too_large:${plan.id}`);
  const contentHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await applyMutation(account.id, 'web', {
    mutationID: deterministicUUID(`training-plan:${plan.id}:${contentHash}`),
    entityID: String(plan.id), kind: 'training_plan', baseVersion: 0,
    provenance: 'userEntered', tombstone: false, payloadBase64: encoded,
  });
  sessions += (plan.weeks || []).reduce((total, week) => total + (week.sessions || []).length, 0);
}
console.log(`Imported ${plans.length} encrypted plan${plans.length === 1 ? '' : 's'} and ${sessions} sessions from ${sourcePath}.`);
