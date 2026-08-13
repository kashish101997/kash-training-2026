import { randomUUID } from 'node:crypto';
import { requireAuth } from '../../lib/auth.js';
import { db, one } from '../../lib/db.js';
import { assertSameOrigin, body, json, method } from '../../lib/http.js';
import { encodePayload } from '../../lib/merge.js';
import { applyMutation } from '../../lib/sync-store.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    assertSameOrigin(req);
    const auth = await requireAuth(req, { webOnly: true });
    const input = body(req);
    const planID = String(input.planID || '');
    if (!/^[a-z0-9][a-z0-9._-]{1,119}$/i.test(planID)) throw new Error('invalid_plan_id');
    const sql = await db();
    const plan = await one(await sql`
      SELECT 1 FROM sync_entities
      WHERE account_id = ${auth.account_id} AND kind = 'training_plan'
        AND entity_id = ${planID} AND tombstone = false
    `);
    if (!plan) throw new Error('training_plan_not_found');
    const enrollment = {
      id: `catalog:${planID}`,
      planID,
      active: Boolean(input.active),
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate || '')) ? String(input.startDate) : null,
      updatedAt: new Date().toISOString(),
      source: 'userEntered',
    };
    const result = await applyMutation(auth.account_id, 'web', {
      mutationID: randomUUID(), entityID: planID, kind: 'plan_enrollment',
      baseVersion: Math.max(0, Number(input.baseVersion || 0)),
      tombstone: false, provenance: 'userEntered', payloadBase64: encodePayload(enrollment),
    });
    return json(res, 200, { enrollment, revision: result.revision });
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}
