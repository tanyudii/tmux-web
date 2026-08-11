// Minimal offline-fallback service worker (Phase 8, scoped down per explicit
// user sign-off: shell offline fallback only, not a full precache/
// background-sync strategy -- see the parent repo's task tracker item #18
// for a fuller offline story if that's ever revisited).
//
// Deliberately does NOT precache the hashed JS/CSS bundles under
// /assets/*.js|css -- vite.config.ts fingerprints those with a pure hex
// content hash, and src/server.ts's cacheControlFor() already grants them
// `public, max-age=31536000, immutable` at the HTTP layer, so the browser's
// own HTTP cache already covers the "fast repeat load" case. Precaching them
// here too would just be a second cache doing the same job, with the added
// risk of silently serving a stale JS/CSS pair after a deploy if this file
// isn't updated in lockstep.
//
// This service worker's only job: when a navigation request (a real page
// load, not an asset/API/WS fetch) fails because the network is
// unreachable, serve the cached offline.html instead of the browser's
// built-in "no internet" page. That's what makes "Add to Home Screen" on
// iOS feel like an app rather than a bookmark that shows a blank white
// screen the moment connectivity drops.
const CACHE_NAME = "tmux-web-shell-v1";
const OFFLINE_URL = "/offline.html";
const SHELL_URLS = [OFFLINE_URL, "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Only intercept top-level navigation requests. Everything else (the
  // hashed JS/CSS bundles, /api/*, /ws, favicon, etc.) passes straight
  // through untouched -- in particular this must never intercept /ws, or
  // it would break the terminal's WebSocket connection.
  if (event.request.mode !== "navigate") return;

  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

// Web Push delivery (task #18f) -- registered by
// pwa/registerServiceWorker.ts, subscribed to by domain/browserPush.ts's
// subscribeBrowserPush, sent by the server's src/push-notifications.ts
// (bell alerts). Mirrors kmp/.../wasmJsMain/resources/sw.js's push +
// notificationclick handlers exactly -- see that file's own comment for why
// they're combined into this one worker rather than a second registration.
//
// iOS Safari note: Web Push only works here at all once this PWA has been
// added to the home screen (iOS 16.4+) -- Safari does not support it for a
// page merely open in a regular browser tab. There is no client-side
// detection for "installed but permission not yet granted" vs. "not
// installed at all"; both look identical to isBrowserPushSupported() until
// the user actually taps the toggle and the permission prompt (or its
// absence) reveals which case they're in.
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
