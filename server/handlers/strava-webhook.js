import { waitUntil } from '@vercel/functions';
import { json, method } from '../../lib/http.js';
import { processIntegrationEvent, queueWebhookEvent } from '../../lib/strava.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  if (req.method === 'GET') {
    const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || process.env.STRAVA_VERIFY_TOKEN;
    if (!expected) return json(res, 503, { error: 'verify_token_not_configured' });
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === expected) {
      return json(res, 200, { 'hub.challenge': req.query['hub.challenge'] });
    }
    return json(res, 403, { error: 'verify_token_mismatch' });
  }
  try {
    const eventID = await queueWebhookEvent(req.body || {});
    if (eventID) waitUntil(processIntegrationEvent(eventID).catch(error => console.error('[strava-event]', error)));
    return json(res, 200, { accepted: true });
  } catch (error) {
    // No 2xx is returned unless the durable event insert succeeded; this lets the sender retry instead
    // of silently losing the event during a database outage.
    console.error('[strava-webhook]', error);
    return json(res, 503, { accepted: false });
  }
}
