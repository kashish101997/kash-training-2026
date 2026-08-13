import { requireAuth } from '../../lib/auth.js';
import { json, method } from '../../lib/http.js';
import { pullChanges } from '../../lib/sync-store.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const auth = await requireAuth(req);
    const cursor = Math.max(0, Number(req.query.cursor || 0));
    return json(res, 200, await pullChanges(auth.account_id, cursor));
  } catch (error) { return json(res, error.status || 400, { error: error.message }); }
}

