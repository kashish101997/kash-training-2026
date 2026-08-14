import { method } from '../../lib/http.js';
import {
  consumeWhoopOAuthState,
  exchangeWhoopAuthorizationCode,
  safeWhoopOAuthReason,
} from '../../lib/whoop.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    if (req.query.error) throw new Error(`whoop_${req.query.error}`);
    const state = await consumeWhoopOAuthState(String(req.query.state || ''));
    if (!state) throw new Error('invalid_oauth_state');
    await exchangeWhoopAuthorizationCode(state.account_id, String(req.query.code || ''));
    return res.redirect(302, '/?whoop=connected');
  } catch (error) {
    const reason = safeWhoopOAuthReason(error);
    console.error('[whoop-oauth-callback]', reason);
    return res.redirect(302, `/?whoop=error&reason=${encodeURIComponent(reason)}`);
  }
}
