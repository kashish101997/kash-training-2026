import { waitUntil } from '@vercel/functions';
import { json, method, rawBody } from '../../lib/http.js';
import {
  processWhoopIntegrationEvent, queueWhoopWebhookEvent, verifyWhoopWebhookSignature,
} from '../../lib/whoop.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const raw = await rawBody(req);
    const signature = req.headers['x-whoop-signature'];
    const timestamp = req.headers['x-whoop-signature-timestamp'];
    if (!verifyWhoopWebhookSignature(raw, signature, timestamp, process.env.WHOOP_CLIENT_SECRET)) {
      return json(res, 401, { error: 'invalid_whoop_signature' });
    }
    const event = JSON.parse(raw.toString('utf8'));
    const eventID = await queueWhoopWebhookEvent(event);
    if (eventID) {
      waitUntil(processWhoopIntegrationEvent(eventID)
        .catch(error => console.error('[whoop-event]', error)));
    }
    return json(res, 202, { accepted: true });
  } catch (error) {
    console.error('[whoop-webhook]', error);
    return json(res, error instanceof SyntaxError ? 400 : 503, { accepted: false });
  }
}
