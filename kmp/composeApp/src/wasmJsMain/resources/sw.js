// tmux-web push notification service worker (EMB-212). Registered from
// BrowserPush.wasmJs.kt's subscribeToPushJs at /sw.js (must be served from
// the origin root for its default scope to cover the whole app -- see
// web-build.ts/server.ts's static-file serving, which serves this
// alongside the rest of the wasmJs dist output). Deliberately minimal: no
// asset caching / offline shell here, just push delivery -- see EMB-215 for
// a PWA offline shell, which is a separate concern from this.

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
