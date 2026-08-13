import { json, method } from '../../lib/http.js';
import { consumeOAuthState, exchangeAuthorizationCode } from '../../lib/strava.js';

export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    if (req.query.error) throw new Error(`strava_${req.query.error}`);
    const state = await consumeOAuthState(String(req.query.state || ''));
    if (!state) throw new Error('invalid_oauth_state');
    await exchangeAuthorizationCode(state.account_id, String(req.query.code || ''));
    return res.redirect(302, '/?strava=connected');
  } catch (error) { return json(res, 400, { error: error.message }); }
}

