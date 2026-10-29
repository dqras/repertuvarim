/*
 * Repertuvarım — service worker
 *
 * Görevi: uygulamanın dosyalarını cihaza kaydetmek ve internet yokken
 * uygulamayı bu kayıtlı kopyadan açmak.
 *
 * ÖNEMLİ: Uygulamanın herhangi bir dosyası değiştiğinde aşağıdaki VERSION
 * değeri artırılmalıdır. Cihazlar yeni sürümü ancak bu dosya değişince fark eder.
 *
 * Şarkılar burada değil, cihazdaki veritabanında (IndexedDB) saklanır. Bu önbellek
 * yalnızca uygulamanın kendi dosyalarını tutar; yenilense bile şarkılar etkilenmez.
 */

const VERSION = '0.5.0';
const CACHE_PREFIX = 'repertuvarim-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;

// Uygulamanın internetsiz açılması için gereken bütün dosyalar.
// Projeye yeni bir dosya eklendiğinde bu listeye de eklenmelidir.
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/pwa.js',
  './js/router.js',
  './js/lib/dom.js',
  './js/lib/text.js',
  './js/data/db.js',
  './js/data/defaults.js',
  './js/data/model.js',
  './js/data/repository.js',
  './js/data/sample-songs.js',
  './js/views/components.js',
  './js/views/dialog.js',
  './js/views/song-list.js',
  './js/views/song-detail.js',
  './js/views/status.js',
  './icons/icon.svg',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: 'reload' → tarayıcının geçici kopyasını atla, sunucudaki en yeni dosyayı al.
      cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  // Güncellemelerde yeni sürüm kendiliğinden devreye girmez; kullanıcı
  // "Güncelle" düğmesine basınca girer. Böylece açık sayfadaki iş yarıda kalmaz.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Eski sürümlerin dosyalarını temizle.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (message.type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Sayfa açılışları: internet olsun olmasın, cihazdaki uygulama sayfası verilir.
  if (request.mode === 'navigate') {
    event.respondWith(serveAppPage(request));
    return;
  }

  event.respondWith(serveFile(request));
});

async function serveAppPage(request) {
  const cache = await caches.open(CACHE_NAME);
  const page = await cache.match('./index.html');
  return page || fetch(request);
}

async function serveFile(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  return cached || fetch(request);
}
