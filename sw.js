const CACHE_NAME = 'moze-lite-v10';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/charts.js',
  './js/sync.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (url.includes('gstatic.com') || url.includes('googleapis.com') || url.includes('firebaseio.com') || url.includes('firebaseapp.com') || url.includes('accounts.google.com') || url.includes('googleusercontent.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
