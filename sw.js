/* Service worker : met l'application en cache pour qu'elle fonctionne sans réseau.
   Aucune donnée patient ne passe ici (elles restent dans le stockage chiffré du navigateur). */
const CACHE = 'astreinte-minuteur-v1.31.1';
const FICHIERS = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/config.js', 'js/rules.js', 'js/csv.js', 'js/store.js', 'js/stats.js', 'js/export.js', 'js/app.js',
  'vendor/xlsx.full.min.js', 'vendor/manrope/manrope-latin-wght-normal.woff2', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' })   // revalide auprès du serveur : pas de vieille version
    .then((rep) => {
      const copie = rep.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copie));
      return rep;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
