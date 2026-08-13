import { requireAuth } from '../../lib/auth.js';
import { json, method } from '../../lib/http.js';
import { createWhoopAuthorization } from '../../lib/whoop.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const auth = await requireAuth(req, { webOnly: true });
    const url = await createWhoopAuthorization(auth.account_id);
    return res.redirect(302, url.toString());
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}
