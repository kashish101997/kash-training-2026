import { requireAuth } from '../../lib/auth.js';
import { encryptJSON } from '../../lib/crypto.js';
import { db } from '../../lib/db.js';
import { assertSameOrigin, body, json, method } from '../../lib/http.js';
import { assertSyncSafePayload } from '../../lib/merge.js';
import { uploadApprovedWorkout } from '../../lib/strava.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const auth = await requireAuth(req);
    if (auth.actor_kind === 'web') assertSameOrigin(req);
    const input = body(req);
    if (input.approved !== true || !input.workout?.id) throw new Error('explicit_approval_required');
    // Reject rather than strip local-only data so a faulty client can never silently send it here.
    assertSyncSafePayload(input.workout);
    const workout = input.workout;
    const result = await uploadApprovedWorkout(auth.account_id, workout);
    const sql = await db();
    const encrypted = encryptJSON(result, `${auth.account_id}:strava-export:${workout.id}`);
    await sql`
      INSERT INTO integration_exports (account_id, provider, entity_id, external_id, status, encrypted_payload)
      VALUES (${auth.account_id}, 'strava', ${String(workout.id)}, ${String(result.id || result.activity_id || '')},
        'submitted', ${JSON.stringify(encrypted)}::jsonb)
    `;
    return json(res, 202, { submitted: true, uploadID: result.id || null, status: result.status || null });
  } catch (error) { return json(res, error.status || 400, { error: error.message }); }
}
