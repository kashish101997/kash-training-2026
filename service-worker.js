/* Kash OS service worker — private APIs are network-only; the UI shell is offline-capable. */
const VERSION = 'kash-os-v6.0.3';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const SHELL_URLS = [
  '/', '/index.html', '/manifest.json', '/icon.svg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
  '/app/styles.css', '/app/main.js', '/app/services.js', '/app/models.js', '/app/state.js',
  '/fonts/poppins-400.ttf', '/fonts/poppins-500.ttf', '/fonts/poppins-600.ttf', '/fonts/poppins-700.ttf',
  '/fonts/raleway-600.ttf', '/fonts/raleway-700.ttf', '/fonts/raleway-800.ttf',
  '/privacy.html', '/docs/KASH_OS_HEALTH_SHORTCUT.md',
];

self.addEventListener('install', event => {
  const freshShell = SHELL_URLS.map(url => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(freshShell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => !key.startsWith(VERSION)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname === '/data.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }
  if (url.origin === location.origin && request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(SHELL).then(cache => cache.put('/', response.clone()));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  if (url.origin === location.origin) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(STATIC).then(cache => cache.put(request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Kash OS', {
    body: payload.body || 'Your planned practice is ready.',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: payload.tag || 'kash-os-reminder', data: { url: payload.url || '/#/today' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => 'focus' in client);
    return existing ? existing.focus().then(client => client.navigate(event.notification.data?.url || '/#/today')) : self.clients.openWindow(event.notification.data?.url || '/#/today');
  }));
});

self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
