import webpush from 'web-push';
import { randomUUID } from 'node:crypto';
import { decryptJSON } from '../../lib/crypto.js';
import { db } from '../../lib/db.js';
import { json, method } from '../../lib/http.js';
import { applyMutation } from '../../lib/sync-store.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return json(res, 401, { error: 'unauthorized' });
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return json(res, 200, { sent: 0, skipped: 'vapid_not_configured' });
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:kash-os@localhost', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const sql = await db();
    const rows = await sql`
      SELECT account_id, entity_id, revision, encrypted_payload FROM sync_entities
      WHERE kind = 'push_subscription' AND tombstone = false
    `;
    let sent = 0; let expired = 0;
    for (const row of rows) {
      const decrypted = decryptJSON(row.encrypted_payload, `${row.account_id}:push_subscription:${row.entity_id}`);
      const data = decrypted.data;
      if (!data.enabled || !data.subscription) continue;
      const categories = data.categories || [];
      const title = 'Kash OS · Today';
      const body = categories.includes('planned_workout') && categories.includes('dharma_practice')
        ? 'Review today’s training and choose your first Dharma practice.'
        : categories.includes('planned_workout') ? 'Review today’s planned training.' : 'Choose your first Dharma practice.';
      try {
        await webpush.sendNotification(data.subscription, JSON.stringify({ title, body, tag: `daily-${new Date().toISOString().slice(0,10)}`, url: '/#/today' }), { TTL: 21_600, urgency: 'normal' });
        sent += 1;
      } catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          await applyMutation(row.account_id, 'web', {
            mutationID: randomUUID(), entityID: row.entity_id, kind: 'push_subscription',
            baseVersion: Number(row.revision || 0), tombstone: true,
            provenance: 'pwa', payloadBase64: null,
          });
          expired += 1;
        } else console.error('[push-reminder]', row.entity_id, error.message);
      }
    }
    return json(res, 200, { sent, expired });
  } catch (error) {
    return json(res, error.status || 400, { error: error.message });
  }
}
