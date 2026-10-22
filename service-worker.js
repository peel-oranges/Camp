/* Camp — service-worker.js
   Makes the app work offline.
   Strategy: always try the internet first (so new questions and app updates show up),
   and fall back to the saved copy when offline.
   "no-cache" below makes the phone ask GitHub "is there a newer version?" every time,
   instead of reusing its own 10-minute browser copy. If nothing changed, GitHub answers
   with a tiny "same as before", so this costs almost no data. */

const CACHE = 'camp-v6';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'questions.json', 'guide.json', 'manifest.json', 'icon.png'];
const FONT_CACHE = 'litquiz-fonts-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'no-cache' }).then(r => { if (r.ok) return c.put(u, r); }).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: use the saved copy if we have it
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
        cache.put(req, res.clone()); return res;
      })))
    );
    return;
  }

  // Only handle this app's own files
  if (url.origin !== self.location.origin) return;

  // The question bank is big (over 1 MB), so give it longer to download
  // before falling back to the saved copy. Other files get 8 seconds.
  const wait = url.pathname.endsWith('questions.json') ? 30000 : 8000;
  const fresh = req.mode === 'navigate'
    ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(req, { cache: 'no-cache' });

  event.respondWith(
    withTimeout(fresh, wait)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
