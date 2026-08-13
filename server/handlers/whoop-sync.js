import { requireAuth } from '../../lib/auth.js';
import { assertSameOrigin, body, json, method } from '../../lib/http.js';
import { syncWhoopAccount } from '../../lib/whoop.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    assertSameOrigin(req);
    const auth = await requireAuth(req, { webOnly: true });
    const days = Math.min(365, Math.max(1, Number(body(req).days || 30)));
    return json(res, 200, { ok: true, ...(await syncWhoopAccount(auth.account_id, { days })) });
  } catch (error) {
    const status = error.status === 429 ? 429 : error.status || 400;
    return json(res, status, { error: error.message, retryAfter: error.retryAfter || null });
  }
}
