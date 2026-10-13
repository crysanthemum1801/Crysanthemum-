/* Chrysanthemum service worker.
   Caches ONLY the same-origin app shell. Every cross-origin request (Firebase, Firestore,
   Cloudflare Worker, Apps Script, Google Fonts, gstatic) and every non-GET request is left
   completely alone, so auth, Firestore and media behave exactly as before.
   Bump CACHE_VERSION on each deployment that changes shell files. */
const CACHE_VERSION = "v2";
const CACHE_PREFIX  = "chrysanthemum-shell-";
const CACHE_NAME    = CACHE_PREFIX + CACHE_VERSION;

// Resolved against the SW's own location, so this works under /Crysanthemum-/ on GitHub Pages.
const SCOPE   = self.registration.scope;                 // e.g. https://crysanthemum1801.github.io/Crysanthemum-/
const u       = (p) => new URL(p, SCOPE).href;
const INDEX   = u("index.html");
const OFFLINE = u("offline.html");

// REQUIRED: install fails (and the old worker stays) only if one of these cannot be fetched.
const PRECACHE_REQUIRED = [u("./"), INDEX, u("manifest.webmanifest")];
// OPTIONAL: cached when available; a missing/404 file here never blocks the service worker from installing.
const PRECACHE_OPTIONAL = [
  OFFLINE, u("style.css"), u("app.js"), u("media.js"),
  u("icons/icon-192.png"), u("icons/icon-512.png"), u("icons/icon-maskable-512.png"),
  u("icons/apple-touch-icon.png"), u("icons/favicon-48.png")
];

const NETWORK_TIMEOUT_MS = 5000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const add = async (url) => {
      // cache:"reload" bypasses the browser HTTP cache so we never precache a stale copy
      const res = await fetch(new Request(url, { cache: "reload" }));
      if (!res.ok) throw new Error("precache failed: " + url + " " + res.status);
      await cache.put(url, res);
    };
    await Promise.all(PRECACHE_REQUIRED.map(add));
    await Promise.all(PRECACHE_OPTIONAL.map((url) => add(url).catch((e) => console.warn("[sw]", e.message))));
    // Deliberately no skipWaiting() here: the page asks for it only when idle (see index.html).
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Delete only OUR old caches; never touch anything else (and never user data).
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Network-first (revalidating) so a new deployment is picked up immediately;
// cache is only a fallback when the network fails or is very slow.
async function networkFirst(request, url, isNavigation) {
  const cache  = await caches.open(CACHE_NAME);
  const key    = isNavigation ? INDEX : url;
  const cached = await cache.match(key, { ignoreSearch: true });

  const ctrl  = new AbortController();
  const timer = cached ? setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS) : null;
  try {
    let res = await fetch(url, { cache: "no-cache", signal: ctrl.signal, credentials: "same-origin" });
    if (res.redirected && isNavigation) res = await fetch(request);   // navigations may not use redirected responses
    if (res.ok && res.type === "basic") {
      cache.put(key, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    if (cached) return cached;
    if (isNavigation) {
      const offline = await cache.match(OFFLINE);
      if (offline) return offline;
    }
    return Response.error();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // never touch writes/uploads
  if (req.headers.has("range")) return;                   // media streaming etc.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Firebase, Worker, Apps Script, fonts: untouched
  if (!url.href.startsWith(SCOPE)) return;                // stay inside the repo subpath
  if (url.pathname.endsWith("/sw.js")) return;            // let the browser update the SW itself

  const isNavigation = req.mode === "navigate";
  event.respondWith(networkFirst(req, url.href, isNavigation));
});
