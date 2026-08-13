import { createHash, randomUUID } from 'node:crypto';
import { requireAuth } from '../../lib/auth.js';
import { assertSameOrigin, body, json, method } from '../../lib/http.js';
import { encodePayload } from '../../lib/merge.js';
import { applyMutation } from '../../lib/sync-store.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET') {
      return json(res, 200, {
        available: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        publicKey: process.env.VAPID_PUBLIC_KEY || null,
        categories: ['planned_workout', 'dharma_practice'],
        medicalAlerts: false,
      });
    }
    assertSameOrigin(req);
    const auth = await requireAuth(req, { webOnly: true });
    const input = body(req);
    const subscription = input.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new Error('invalid_push_subscription');
    if (!/^https:\/\//.test(subscription.endpoint) || subscription.endpoint.length > 2048) throw new Error('invalid_push_endpoint');
    const id = `webpush:${createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 40)}`;
    const value = {
      id, subscription,
      categories: Array.isArray(input.categories) ? input.categories.filter(value => ['planned_workout', 'dharma_practice'].includes(value)) : ['planned_workout', 'dharma_practice'],
      timezone: String(input.timezone || 'Asia/Kolkata').slice(0, 100),
      enabled: input.enabled !== false,
      updatedAt: new Date().toISOString(),
    };
    const result = await applyMutation(auth.account_id, 'web', {
      mutationID: randomUUID(), entityID: id, kind: 'push_subscription',
      baseVersion: Math.max(0, Number(input.baseVersion || 0)), tombstone: false,
      provenance: 'pwa', payloadBase64: encodePayload(value),
    });
    return json(res, 200, { id, revision: result.revision, enabled: value.enabled });
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}
