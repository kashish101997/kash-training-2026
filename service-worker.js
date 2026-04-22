/* Kash Training Platform — Service Worker
 * v2.0 · stale-while-revalidate for app shell, cache-first for fonts & CDNs.
 * Bump CACHE_VERSION to force clients to pull fresh assets.
 */
const CACHE_VERSION = 'kash-v2.0.0';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const BASE = '/kash-training-2026/';

// Files that make up the app shell — cache on install.
const SHELL_URLS = [
    BASE,
    BASE + 'index.html',
    BASE + 'manifest.json',
    BASE + 'icon.svg',
    BASE + 'data.json'
];

// Origins whose responses are safe to cache-first (long-lived CDN assets).
const CDN_ORIGINS = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://cdnjs.cloudflare.com',
    'https://unpkg.com'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) =>
            cache.addAll(SHELL_URLS).catch((err) => {
                console.warn('[SW] shell precache partial:', err.message);
            })
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => !k.startsWith(CACHE_VERSION))
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Cache-first for long-lived CDN assets (fonts, GSAP, Lucide).
    if (CDN_ORIGINS.includes(url.origin)) {
        event.respondWith(
            caches.open(ASSET_CACHE).then((cache) =>
                cache.match(req).then((hit) => {
                    if (hit) return hit;
                    return fetch(req).then((res) => {
                        // Only cache successful opaque/basic responses.
                        if (res && (res.status === 200 || res.type === 'opaque')) {
                            cache.put(req, res.clone());
                        }
                        return res;
                    }).catch(() => hit); // offline fallback: whatever we have
                })
            )
        );
        return;
    }

    // Stale-while-revalidate for same-origin navigations + shell.
    if (url.origin === location.origin) {
        event.respondWith(
            caches.open(SHELL_CACHE).then((cache) =>
                cache.match(req).then((hit) => {
                    const network = fetch(req).then((res) => {
                        if (res && res.status === 200) cache.put(req, res.clone());
                        return res;
                    }).catch(() => hit);
                    return hit || network;
                })
            )
        );
        return;
    }

    // Default: try network, fall through.
});

// Allow the page to trigger an immediate SW update.
self.addEventListener('message', (e) => {
    if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
