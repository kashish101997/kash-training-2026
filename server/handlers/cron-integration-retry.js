import { db } from '../../lib/db.js';
import { json, method } from '../../lib/http.js';
import { processIntegrationEvent as processStravaIntegrationEvent } from '../../lib/strava.js';
import { processWhoopIntegrationEvent } from '../../lib/whoop.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'unauthorized' });
  }
  const sql = await db();
  const rows = await sql`
    SELECT id, provider FROM integration_events
    WHERE attempts < 10 AND (
      (status IN ('pending', 'retry') AND next_attempt_at <= now())
      OR (status = 'processing' AND next_attempt_at < now() - interval '5 minutes')
    )
    ORDER BY next_attempt_at LIMIT 20
  `;
  for (const row of rows) {
    const processor = row.provider === 'whoop'
      ? processWhoopIntegrationEvent
      : row.provider === 'strava' ? processStravaIntegrationEvent : null;
    if (processor) await processor(row.id).catch(() => {});
  }
  return json(res, 200, { processed: rows.length });
}
