import { requireAuth } from '../../lib/auth.js';
import { db } from '../../lib/db.js';
import { assertSameOrigin, json, method } from '../../lib/http.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    assertSameOrigin(req);
    const auth = await requireAuth(req, { webOnly: true });
    const sql = await db();
    await sql`DELETE FROM oauth_tokens WHERE account_id = ${auth.account_id} AND provider = 'strava'`;
    await sql`INSERT INTO audit_log (account_id, actor_kind, action) VALUES (${auth.account_id}, 'web', 'strava_disconnect')`;
    return json(res, 200, { ok: true });
  } catch (error) { return json(res, error.status || 400, { error: error.message }); }
}

