import { requireAuth } from '../../lib/auth.js';
import { decryptJSON } from '../../lib/crypto.js';
import { db } from '../../lib/db.js';
import { json, method } from '../../lib/http.js';

const PRIMARY_PLAN_ID = 'hyrox-current';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const auth = await requireAuth(req, { webOnly: true });
    const sql = await db();
    const rows = await sql`
      SELECT kind, entity_id, encrypted_payload
      FROM sync_entities
      WHERE account_id = ${auth.account_id} AND tombstone = false
        AND ((kind = 'training_plan' AND entity_id = ${PRIMARY_PLAN_ID})
          OR (kind = 'plan_enrollment' AND entity_id = ${PRIMARY_PLAN_ID}))
      ORDER BY kind, entity_id
    `;
    const decoded = rows.map(row => ({
      kind: row.kind,
      data: decryptJSON(row.encrypted_payload, `${auth.account_id}:${row.kind}:${row.entity_id}`).data,
    }));
    const fullPlans = decoded.filter(row => row.kind === 'training_plan').map(row => row.data.plan);
    const plans = req.query.summary === '1' ? fullPlans.map(plan => ({
      id: plan.id,
      title: plan.title,
      modality: plan.modality || plan.modalities || null,
      weekCount: (plan.weeks || []).length,
      sessionCount: (plan.weeks || []).reduce((total, week) => total + (week.sessions || []).length, 0),
      datePolicy: plan.datePolicy || null,
    })) : fullPlans;
    const enrollments = decoded.filter(row => row.kind === 'plan_enrollment').map(row => row.data);
    return json(res, 200, { plans, enrollments, count: plans.length });
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}
