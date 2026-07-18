// tmux-web service worker: Web Push delivery (EMB-212) + app-shell caching
// and an offline fallback (EMB-215), combined into one worker rather than
// two competing registrations -- a page can only be controlled by a single
// active service worker at a time, so EMB-215's own ticket explicitly calls
// for coordinating with EMB-212 instead of registering a second one.
// Registered from BrowserPush.wasmJs.kt's subscribeToPushJs at /sw.js (must
// be served from the origin root for its default scope to cover the whole
// app -- see web-build.ts/server.ts's static-file serving, which serves
// this alongside the rest of the wasmJs dist output).

// Bumped whenever the precached shell list below changes, so `activate`
// evicts the previous version's cache instead of accumulating forever.
const SHELL_CACHE = "tmux-web-shell-v1";

// Only paths with names fixed at build time -- NOT composeApp.js/*.wasm,
// which webpack content-hashes into an unpredictable filename per build
// (see kmp/composeApp/build.gradle.kts's wasmJs target), so this worker's
// own source can't know them ahead of time. Those are cached lazily by the
// runtime cache-first strategy in the fetch handler below instead, the
// first time each one is actually requested.
const SHELL_PATHS = ["/", "/index.html", "/offline.html", "/manifest.json", "/vendor/xterm.css", "/vendor/xterm.js", "/vendor/addon-fit.js"];

// Requests that must always go to the network, never served from or
// written to any cache -- session/project state and the terminal socket
// are never allowed to go stale the way a cached JS bundle safely can.
function isNeverCached(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/internal/") || url.pathname.startsWith("/ws");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_PATHS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || isNeverCached(url)) return;

  // Navigations (address-bar loads, PWA launches, reloads) get their own
  // strategy so a total network outage shows the informative offline shell
  // instead of the browser's own generic "can't reach this page" error.
  //
  // Falls straight to /offline.html, deliberately NOT cached /index.html:
  // this app has no client-rendered "you're offline" state of its own (see
  // ChangesRail.kt's RepoStateBanner for the closest analogue, which only
  // covers git conflicts) -- a booted Compose app with a dead API/WS
  // connection just renders an indefinitely-loading blank canvas, which is
  // no more informative than the browser's own generic error page. Verified
  // live: an earlier version of this handler that tried cached /index.html
  // first produced exactly that blank-canvas outcome under a real simulated
  // network outage (empty document.body.innerText), which is why this
  // shortcuts straight to the dedicated shell instead.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
    return;
  }

  // Everything else same-origin (the hashed composeApp.js/*.wasm bundle,
  // vendor/*, icons/*) is cache-first: content-hashed filenames mean a
  // cached response is never stale -- a new build simply requests a
  // different filename, so this doubles as a permanent per-build cache
  // without needing any invalidation logic. Not-yet-cached requests are
  // fetched once and stashed for next time.
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "tmux-web", body: "A session needs your attention" };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: "tmux-web-bell",
    }),
  );
});

// Focuses an already-open tmux-web tab if one exists, otherwise opens a new
// one -- clicking the OS notification should get the user back into the app
// they were just alerted about, not leave the notification just dismissed
// with nothing else happening.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
      return undefined;
    }),
  );
});
