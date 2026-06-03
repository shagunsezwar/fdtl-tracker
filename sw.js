const CACHE = 'fdtl-v36';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon192.png', '/icon512.png'];

self.addEventListener('install', e => {
  // Skip waiting immediately so new SW activates fast
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => {
      // Cache individually so one failure doesn't block the rest
      return Promise.allSettled(ASSETS.map(a => c.add(a).catch(()=>{})));
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Never intercept API calls
  if (e.request.url.includes('/api/') || e.request.url.includes('api.anthropic.com')) {
    return;
  }
  // Network first, cache fallback
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp && resp.status === 200 && e.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request)
        .then(cached => cached || caches.match('/index.html'))
      )
  );
});
