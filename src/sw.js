// Service worker TSENA : garde l'application disponible sans connexion.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const APP_CACHE = 'tsena-app-' + VERSION;
const FONT_CACHE = 'tsena-fonts';

// Installation : chaque fichier est téléchargé à neuf (?v=version, sans cache) pour ne jamais garder une ancienne
// copie servie par l'hébergeur (GitHub Pages garde ses fichiers jusqu'à 10 minutes).
const fresh = (u) => new Request(u + (u.includes('?') ? '&' : '?') + 'v=' + VERSION, { cache: 'reload' });
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => Promise.all(PRECACHE.map(async (u) => {
    const res = await fetch(fresh(u));
    if (!res.ok) throw new Error(u + ' : HTTP ' + res.status);
    await c.put(u, res.clone());
    if (u === './') await c.put('./index.html', res);
  }))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('tsena-app-') && k !== APP_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Polices Google : servies depuis le cache, rafraîchies en arrière-plan.
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // cloud (Supabase) : jamais mis en cache
  if (url.pathname.endsWith('/version.json')) return;

  // Pages : la version en ligne d'abord (évite une page périmée après une mise à jour), sinon celle du cache.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(new Request(req.url.split('#')[0].split('?')[0] + '?v=' + Date.now(), { signal: ctrl.signal, cache: 'no-store' }));
        clearTimeout(t);
        if (res.ok) { cache.put('./index.html', res.clone()); return res; }
        throw new Error('HTTP ' + res.status);
      } catch {
        return (await cache.match('./index.html')) || (await caches.match('./index.html')) || fetch(req);
      }
    })());
    return;
  }
  // Fichiers de l'application : cache d'abord, sinon réseau (et mise en cache).
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: url.pathname.includes('/assets/') });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && url.pathname.includes('/assets/')) (await caches.open(APP_CACHE)).put(req, res.clone());
    return res;
  })());
});
