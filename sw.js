const CACHE = 'fdtl-v61';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon192.png', '/icon512.png'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a).catch(function(){})))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.url.indexOf('/api/') !== -1 || e.request.url.indexOf('api.anthropic.com') !== -1) return;
  e.respondWith(fetch(e.request).then(function(resp) {
    if (resp && resp.status === 200 && e.request.method === 'GET') {
      var clone = resp.clone();
      caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
    }
    return resp;
  }).catch(function() { return caches.match(e.request).then(function(c) { return c || caches.match('/index.html'); }); }));
});
