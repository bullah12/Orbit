// Cache public files only. Supabase requests and personalised data never enter CacheStorage.
const CACHE = 'orbit-public-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'])));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('orbit-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match('/offline.html')) || Response.error()));
    return;
  }
  // Vite's content-hashed bundles are immutable. Never cache HTML or API responses here.
  if (!/^\/assets\/[^/]+-[\w-]+\.(js|css)$/.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok && /javascript|text\/css/.test(response.headers.get('content-type') || '')) {
      await cache.put(event.request, response.clone());
      const keys = (await cache.keys()).filter((key) => new URL(key.url).pathname.startsWith('/assets/'));
      for (const key of keys.slice(0, Math.max(0, keys.length - 60))) await cache.delete(key);
    }
    return response;
  })());
});
