import integrationRetry from '../server/handlers/cron-integration-retry.js';
import whoopReconcile from '../server/handlers/cron-whoop-reconcile.js';
import stravaCallback from '../server/handlers/strava-callback.js';
import stravaConnect from '../server/handlers/strava-connect.js';
import stravaDisconnect from '../server/handlers/strava-disconnect.js';
import stravaUpload from '../server/handlers/strava-upload.js';
import stravaStatus from '../server/handlers/strava-status.js';
import stravaWebhook from '../server/handlers/strava-webhook.js';
import syncPull from '../server/handlers/sync-pull.js';
import syncPush from '../server/handlers/sync-push.js';
import trainingCatalog from '../server/handlers/training-catalog.js';
import trainingEnrollment from '../server/handlers/training-enrollment.js';
import whoopCallback from '../server/handlers/whoop-callback.js';
import whoopConnect from '../server/handlers/whoop-connect.js';
import whoopDisconnect from '../server/handlers/whoop-disconnect.js';
import whoopStatus from '../server/handlers/whoop-status.js';
import whoopSync from '../server/handlers/whoop-sync.js';
import whoopWebhook from '../server/handlers/whoop-webhook.js';
import healthShortcut from '../server/handlers/health-shortcut.js';
import pushSubscription from '../server/handlers/push-subscription.js';
import pushReminders from '../server/handlers/cron-push-reminders.js';

const handlers = Object.freeze({
  'cron-integration-retry': integrationRetry,
  'cron-whoop-reconcile': whoopReconcile,
  'strava-callback': stravaCallback,
  'strava-connect': stravaConnect,
  'strava-disconnect': stravaDisconnect,
  'strava-upload': stravaUpload,
  'strava-status': stravaStatus,
  'strava-webhook': stravaWebhook,
  'sync-pull': syncPull,
  'sync-push': syncPush,
  'training-catalog': trainingCatalog,
  'training-enrollment': trainingEnrollment,
  'whoop-callback': whoopCallback,
  'whoop-connect': whoopConnect,
  'whoop-disconnect': whoopDisconnect,
  'whoop-status': whoopStatus,
  'whoop-sync': whoopSync,
  'whoop-webhook': whoopWebhook,
  'health-shortcut': healthShortcut,
  'push-subscription': pushSubscription,
  'cron-push-reminders': pushReminders,
});

export default async function handler(req, res) {
  const route = Array.isArray(req.query?.route) ? req.query.route[0] : req.query?.route;
  const selected = handlers[String(route || '')];
  if (!selected) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'not_found' });
  }
  return selected(req, res);
}
