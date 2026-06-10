/* GitHub Contents API helper — the single write path for data.json.
 * Every ingestion route (Strava webhook, future WhatsApp webhook) commits
 * through here; Vercel's git integration redeploys and loadRemote() merges
 * on next app open.
 */

const REPO = process.env.GITHUB_REPO || 'kashish101997/kash-training-2026';
const FILE_PATH = 'data.json';
const API = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

function ghHeaders() {
    return {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'kash-training-platform'
    };
}

async function getDataJson() {
    const res = await fetch(`${API}?ref=main`, { headers: ghHeaders() });
    if (!res.ok) throw new Error(`GitHub GET ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const content = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    return { content, sha: body.sha };
}

async function putDataJson(content, sha, message) {
    const res = await fetch(API, {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify({
            message,
            content: Buffer.from(JSON.stringify(content, null, 2) + '\n').toString('base64'),
            sha,
            branch: 'main'
        })
    });
    if (!res.ok) {
        const err = new Error(`GitHub PUT ${res.status}: ${await res.text()}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

/* mutateFn(data) mutates the parsed data.json in place and returns
 * true to commit or false to skip (e.g. duplicate detected).
 * Retries once on SHA conflict (409/422) from a concurrent commit. */
export async function commitDataJson(mutateFn, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const { content, sha } = await getDataJson();
        const shouldCommit = mutateFn(content);
        if (!shouldCommit) return { committed: false, reason: 'mutation declined (duplicate?)' };
        content.lastUpdated = new Date().toISOString();
        try {
            const result = await putDataJson(content, sha, message);
            return { committed: true, sha: result.content && result.content.sha };
        } catch (e) {
            if (attempt === 0 && (e.status === 409 || e.status === 422)) continue; // stale SHA — refetch and retry
            throw e;
        }
    }
    throw new Error('commitDataJson: retry exhausted');
}
