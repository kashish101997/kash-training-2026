/* Strava Webhook Events API receiver.
 *
 * GET  — subscription validation: echo hub.challenge when hub.verify_token matches.
 * POST — activity events: for create events from Kash's athlete ID, fetch the
 *        activity, map to the workouts schema, dedupe, commit data.json.
 *
 * Subscription is created once via:
 *   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
 *     -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
 *     -F callback_url=https://<deployment>/api/strava-webhook \
 *     -F verify_token=$STRAVA_VERIFY_TOKEN
 */

import { commitDataJson } from '../lib/github.js';
import { getActivity, mapActivity, isDuplicate } from '../lib/strava.js';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
            return res.status(200).json({ 'hub.challenge': challenge });
        }
        return res.status(403).json({ error: 'verify token mismatch' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'method not allowed' });
    }

    // Strava requires a 200 within 2s; do the work after acknowledging intent.
    // Vercel functions keep running until the response is sent, so we process
    // first but keep it fast (single activity fetch + one commit).
    const event = req.body || {};
    const isCreate = event.object_type === 'activity' && event.aspect_type === 'create';
    const isOwner = String(event.owner_id) === String(process.env.STRAVA_ATHLETE_ID);

    if (!isCreate || !isOwner) {
        return res.status(200).json({ ignored: true });
    }

    try {
        const activity = await getActivity(event.object_id);
        const workout = mapActivity(activity);
        if (!workout || !workout.date) {
            return res.status(200).json({ ignored: true, reason: 'unsupported activity type' });
        }
        const result = await commitDataJson(data => {
            if (isDuplicate(workout, data)) return false;
            data.workouts = data.workouts || [];
            data.workouts.push(workout);
            data.workouts.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            data.lastStravaSync = new Date().toISOString();
            return true;
        }, `data: strava webhook — ${workout.name} (${workout.date})`);
        return res.status(200).json({ ok: true, ...result });
    } catch (e) {
        // Always 200 — Strava retries non-2xx and disables flaky subscriptions.
        console.error('[strava-webhook]', e.message);
        return res.status(200).json({ ok: false, error: e.message });
    }
}
