import { requireAuth } from '../../lib/auth.js';
import { db, one } from '../../lib/db.js';
import { json, method } from '../../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const auth = await requireAuth(req, { webOnly: true });
    const sql = await db();
    const row = await one(await sql`
      SELECT external_account_id, updated_at FROM oauth_tokens
      WHERE account_id = ${auth.account_id} AND provider = 'strava'
    `);
    return json(res, 200, {
      connected: Boolean(row),
      athleteID: row?.external_account_id || null,
      updatedAt: row?.updated_at || null,
      updateMode: 'webhook-and-reconciliation',
    });
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}
