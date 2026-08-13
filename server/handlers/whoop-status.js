import { requireAuth } from '../../lib/auth.js';
import { json, method } from '../../lib/http.js';
import { getWhoopDashboard } from '../../lib/whoop.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const auth = await requireAuth(req, { webOnly: true });
    return json(res, 200, await getWhoopDashboard(auth.account_id));
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}
