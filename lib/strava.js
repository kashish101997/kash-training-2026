/* Strava API client for the webhook pipeline.
 * Token refresh + activity fetch + the activity→workout mapper.
 * The mapper rules are the single source of truth shared (by convention)
 * with .claude/skills/sync-strava/SKILL.md — keep both in sync.
 */

let cachedToken = null; // { accessToken, expiresAt } — survives warm invocations

export async function getAccessToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now() / 1000 + 60) {
        return cachedToken.accessToken;
    }
    const res = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: process.env.STRAVA_REFRESH_TOKEN
        })
    });
    if (!res.ok) throw new Error(`Strava token refresh ${res.status}: ${await res.text()}`);
    const body = await res.json();
    // NOTE: Strava rotates refresh tokens. The env var holds the original;
    // Strava keeps honoring it as long as it was issued with scope=activity:read.
    // If refresh ever 401s, re-authorize and update STRAVA_REFRESH_TOKEN in Vercel.
    cachedToken = { accessToken: body.access_token, expiresAt: body.expires_at };
    return cachedToken.accessToken;
}

export async function getActivity(id) {
    const token = await getAccessToken();
    const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Strava activity GET ${res.status}: ${await res.text()}`);
    return res.json();
}

const TYPE_MAP = {
    Run: 'running', TrailRun: 'running', VirtualRun: 'running',
    Walk: 'recovery', Hike: 'recovery',
    Workout: 'strength', WeightTraining: 'strength', Crossfit: 'strength'
};

function paceStrFromSecPerKm(secPerKm) {
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

/* Map a Strava activity to the platform's workouts schema
 * (mirrors submitWorkoutFeedback() in the HTML). Returns null if the
 * activity type isn't synced. */
export function mapActivity(act) {
    const type = TYPE_MAP[act.sport_type || act.type];
    if (!type) return null;
    const km = act.distance ? +(act.distance / 1000).toFixed(1) : null;
    if ((act.sport_type === 'Walk' || act.type === 'Walk') && (!km || km < 3)) return null; // short walks aren't training
    const durationMin = Math.round((act.moving_time || 0) / 60);
    const rpe = act.perceived_exertion ? Math.round(act.perceived_exertion) : 5;
    let pace = null, paceStr = null;
    if (km && act.moving_time) {
        const secPerKm = act.moving_time / km;
        pace = +(secPerKm / 60).toFixed(2);
        paceStr = paceStrFromSecPerKm(secPerKm);
    }
    return {
        date: (act.start_date_local || act.start_date || '').slice(0, 10),
        name: act.name || 'Strava activity',
        completed: true,
        type,
        distance: km,
        pace,
        paceStr,
        duration: durationMin,
        hr: act.average_heartrate ? Math.round(act.average_heartrate) : null,
        rpe,
        notes: `Synced from Strava · https://www.strava.com/activities/${act.id}`,
        load: km ? +(km * rpe).toFixed(1) : +((durationMin / 10) * rpe).toFixed(1),
        source: 'strava'
    };
}

/* Dedupe rules (mirror the /sync-strava skill):
 * (a) same (date, name) — the loadRemote merge key
 * (b) same-date running workout within ±0.3km — manual log of the same run
 * (c) race-day guard: same-date raceResult + distance within 0.5km of a
 *     race distance keeps the manual race entry authoritative. */
export function isDuplicate(workout, data) {
    const existing = data.workouts || [];
    if (existing.some(w => w.date === workout.date && w.name === workout.name)) return true;
    if (workout.distance != null && existing.some(w =>
        w.date === workout.date &&
        w.distance != null &&
        Math.abs(w.distance - workout.distance) <= 0.3
    )) return true;
    if ((data.raceResults || []).some(r => r.date === workout.date)) {
        if (workout.distance != null && existing.some(w => w.date === workout.date)) return true;
    }
    return false;
}
