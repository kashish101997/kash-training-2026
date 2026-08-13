import { json, method } from '../../lib/http.js';
import { reconcileConnectedWhoopAccounts } from '../../lib/whoop.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'unauthorized' });
  }
  const results = await reconcileConnectedWhoopAccounts(7);
  return json(res, results.some(result => !result.ok) ? 207 : 200, { results });
}
