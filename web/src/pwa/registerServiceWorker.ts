// Wires up public/sw.js (copied verbatim into dist/ by Vite, served at
// `/sw.js` -- see src/server.ts's serveStatic()). Deliberately thin: this
// phase's scope (per explicit user sign-off, given rising session cost) is
// just registering the minimal offline-fallback worker, not a full
// precache/update-prompt UI -- see the parent repo's task #18 for a fuller
// offline story if that's ever revisited.
//
// Injectable navigator/window so this can be unit tested without a real
// browser service-worker implementation (unavailable under jsdom, same
// reasoning as this codebase's other DI-testable browser-API wrappers --
// see connectionSettingsStore's `matchMediaImpl` for the established
// pattern).
export interface RegisterServiceWorkerDeps {
  navigatorImpl?: Navigator;
  windowImpl?: Window;
}

export function registerServiceWorker(deps: RegisterServiceWorkerDeps = {}): void {
  const navigatorImpl = deps.navigatorImpl ?? navigator;
  const windowImpl = deps.windowImpl ?? window;

  // Absent entirely on insecure origins (see CLAUDE.md's clipboard-paste
  // investigation for the same secure-context restriction on a different
  // API) and on browsers that never implemented it -- either way, a no-op
  // registration attempt would just throw, so skip it outright.
  if (!("serviceWorker" in navigatorImpl)) return;

  windowImpl.addEventListener("load", () => {
    void navigatorImpl.serviceWorker.register("/sw.js").catch(() => {
      // Registration failure is non-fatal -- the app is fully functional
      // online either way, it just loses the offline-fallback page. Matches
      // this codebase's existing graceful-degrade pattern (see
      // downloadWebBuild() in the parent CLI's src/cli/upgrade.ts).
    });
  });
}
