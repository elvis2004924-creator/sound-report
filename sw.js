// 離線快取：第一次打開後，整個 App 都存在手機上，之後沒有網路也能使用。
// 每次更新程式時，請把下面的版本號加 1，手機才會下載新版。
const VERSION = 'soundreport-v1.3.2';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/logic.js',
  'js/store.js',
  'js/pdf.js',
  'js/ttf.js',
  'fonts/SoundReportHei-Regular.ttf',
  'fonts/SoundReportHei-Bold.ttf',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/logo.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html');
      try { return await fetch(req); } catch { if (shell) return shell; throw new Error('offline'); }
    }
    return fetch(req);
  })());
});
