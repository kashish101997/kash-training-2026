import { requireAuth } from '../../lib/auth.js';
import { assertSameOrigin, body, json, method } from '../../lib/http.js';
import { applyMutation } from '../../lib/sync-store.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const auth = await requireAuth(req);
    if (auth.actor_kind === 'web') assertSameOrigin(req);
    const mutations = body(req).mutations;
    if (!Array.isArray(mutations) || mutations.length > 100) throw new Error('invalid_batch');
    const results = [];
    for (const mutation of mutations) results.push(await applyMutation(auth.account_id, auth.actor_kind, mutation));
    return json(res, 200, { results });
  } catch (error) { return json(res, error.status || 400, { error: error.message }); }
}

