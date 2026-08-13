import { requireAuth } from '../../lib/auth.js';
import { assertSameOrigin, json, method } from '../../lib/http.js';
import { disconnectWhoopAccount } from '../../lib/whoop.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    assertSameOrigin(req);
    const auth = await requireAuth(req, { webOnly: true });
    await disconnectWhoopAccount(auth.account_id);
    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}
