# TDD Evidence: Integrate tmux-web KMP client with the tmux-web backend

**Source**: inline `/plan` output from this session (no `*.plan.md` file written — conversational mode). Confirmed by the user with "yes using /tdd-workflow".

## User journeys

1. As the operator, I want the backend to serve the compiled KMP Web build directly, so opening the server's URL in a browser gives me the app with no separate dev server and no CORS configuration needed in production.
2. As a developer, I want `wasmJsBrowserDevelopmentRun` to reach my real local backend without CORS errors, so I can iterate on the Web UI against real data.
3. As a user, I want to see *something* when the client can't load my projects (backend down, bad token, network error), instead of a silently empty sidebar.

## Task report

### Task 1 — `.wasm` served with the correct content type
- **Summary**: `serveStatic()`'s `MIME_TYPES` map had no `.wasm` entry, defaulting to `application/octet-stream`, which breaks `WebAssembly.instantiateStreaming()` (what the KMP Web build's entry point uses to load its `.wasm` binaries).
- **RED**: `node --experimental-strip-types --test --test-name-pattern="application/wasm" src/server.test.ts` → `AssertionError: expected 'application/wasm', actual 'application/octet-stream'`.
- **GREEN**: added `.wasm": "application/wasm"` to `MIME_TYPES` in `src/server.ts`. Re-ran `node --experimental-strip-types --test src/server.test.ts` → 65/65 pass.
- **Guarantee**: any `.wasm` file served from `publicDir` gets `Content-Type: application/wasm`.

### Task 2 — wire `ServerDeps.publicDir` to the KMP build output
- **Summary**: `publicDir`/`serveStatic()` already existed (and were already tested — 3 pre-existing tests for index.html default, path-traversal, 404) but nothing in `src/main.ts` ever set `publicDir`; `public/` (the old vanilla-JS client) no longer exists on disk. Extracted the one piece of genuinely testable new logic — "does this look like a real build, or has it just not been run yet" — into `resolveWebBuildDir()`.
- **RED**: `node --experimental-strip-types --test src/web-build.test.ts` failed to resolve the module (`ERR_MODULE_NOT_FOUND`) — compile-time RED, `src/web-build.ts` didn't exist yet.
- **GREEN**: created `src/web-build.ts` (`resolveWebBuildDir(dir)` → `dir` if `dir/index.html` exists, else `undefined`). Re-ran → 3/3 pass.
- **Wiring**: `src/main.ts` now computes `DEFAULT_WEB_BUILD_DIR` (relative to `main.ts` via `fileURLToPath(new URL(...))`, matching the existing convention in `src/cli/version.ts`) pointing at `kmp/composeApp/build/dist/wasmJs/productionExecutable`, overridable via `TMUX_WEB_PUBLIC_DIR`, and passes the resolved result as `publicDir`. `main.ts` itself has no test file — consistent with the existing repo convention (zero pre-existing tests for this entry-point-wiring file); the testable decision logic lives in `resolveWebBuildDir()` instead.
- **Guarantee**: `npm start` serves the compiled KMP build at `/` when it exists, and degrades to API-only (not a crash) when it doesn't.
- **Full regression check**: `npx tsc --noEmit` → no errors. `node --experimental-strip-types --test src/*.test.ts src/cli/*.test.ts` → 363/365 pass; the 2 failures (`pty-bridge.test.ts` real-tmux-integration tests) are pre-existing, environment-dependent (no real tmux available in this sandbox) and untouched by this work.

### Task 3 — local-dev webpack proxy (`/api`, `/ws*` → real backend)
- **Summary**: added a `devServer.proxy` entry to the `wasmJs { browser { commonWebpackConfig { ... } } }` block in `kmp/composeApp/build.gradle.kts`, so `wasmJsBrowserDevelopmentRun` forwards `/api` and `/ws*` to `http://127.0.0.1:5309` (default backend port) by default, overridable via `-PbackendUrl=...`.
- **Not TDD in the traditional sense**: this is declarative Gradle/webpack config, not executable business logic — no RED/GREEN cycle applies. Documented here as an intentional gap per the skill's own allowance, not silently skipped.
- **What was actually verified**: the exact `KotlinWebpackConfig.DevServer`/`.DevServer.Proxy` constructor signatures were checked against the real, pinned `kotlin-gradle-plugin-2.3.20-gradle813.jar` (via `javap` on the class files) rather than guessed from memory. `./gradlew :composeApp:tasks --all` evaluates the full build script (including this block) without error, proving the Kotlin DSL usage compiles.
- **What was NOT confirmed**: an end-to-end curl-through-the-proxy check was attempted (real dev server + a throwaway fake HTTP backend) but was inconclusive — the background dev-server process was torn down by this session's own cleanup before the check completed cleanly, a test-harness process-lifecycle issue, not evidence of a proxy misconfiguration. **Follow-up**: run `npm run dev` + `./gradlew :composeApp:wasmJsBrowserDevelopmentRun` together locally and confirm the sidebar loads real projects with no CORS console errors before relying on this for daily use.

### Task 4 — surface `WebShellUiState.errorMessage`
- **Summary**: every load/poll failure in `WebShellViewModel` already set `errorMessage`, but nothing in `WebShellScreen` rendered it — discovered live during manual browser verification of the Web shell (a backend failure left the sidebar silently empty). Added `TmuxErrorBanner` (`ui/components/`), wired into `WebShellScreen` above the sidebar/main-pane row.
- **Not unit-tested**: Compose UI (`com.tanyudii.tmuxweb.ui.*`) is excluded from the Kover coverage gate by an existing, documented decision in `composeApp/build.gradle.kts` ("automated UI-tree tests have limited value on these targets... each screen gets a manual QA pass instead") — this change follows that same, pre-existing convention rather than introducing a one-off exception.
- **What was verified**: `./gradlew :composeApp:compileKotlinJvm :composeApp:detekt :composeApp:compileKotlinWasmJs :composeApp:jvmTest -q` all pass clean after the change (compiles on every target, no lint regressions, `WebShellViewModelTest`'s existing `errorMessage`-setting assertions still pass).

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | `.wasm` static files are served with `Content-Type: application/wasm` | `src/server.test.ts:"serves .wasm static files with the application/wasm content type"` | integration | PASS | `node --experimental-strip-types --test src/server.test.ts` (65/65) |
| 2 | A real KMP build dir (has `index.html`) is returned as-is | `src/web-build.test.ts:"resolveWebBuildDir returns the dir when it contains index.html"` | unit | PASS | `node --experimental-strip-types --test src/web-build.test.ts` (3/3) |
| 3 | A dir without `index.html` (build not run) resolves to `undefined`, not a crash | `src/web-build.test.ts:"...returns undefined for a dir without index.html"` | unit | PASS | same run |
| 4 | A nonexistent dir resolves to `undefined` | `src/web-build.test.ts:"...returns undefined for a nonexistent directory"` | unit | PASS | same run |
| 5 | Full backend test suite unaffected by this work | `node --experimental-strip-types --test src/*.test.ts src/cli/*.test.ts` | regression | PASS (363/365; 2 pre-existing env-dependent failures unrelated to this work) | see Task 2 |
| 6 | `main.ts` TypeScript compiles with the new imports/wiring | `npx tsc --noEmit` | typecheck | PASS | Task 2 |
| 7 | KMP build.gradle.kts's new devServer proxy block is valid Kotlin DSL | `./gradlew :composeApp:tasks --all` | build-eval | PASS | Task 3 |
| 8 | KMP Web shell UI compiles on JVM and Wasm targets, detekt clean | `./gradlew :composeApp:compileKotlinJvm :composeApp:detekt :composeApp:compileKotlinWasmJs :composeApp:jvmTest -q` | compile/lint/test | PASS | Task 4 |

## Coverage and known gaps

- Backend (`src/`): standard `node --test` suite, no formal coverage threshold enforced in this repo's `package.json` (`test:coverage` exists but has no gate) — the new code (Tasks 1–2) is fully exercised by the tests above.
- KMP (`kmp/`): Kover's 80% gate applies to `commonMain` excluding `ui`/`terminal`/generated packages (pre-existing, documented exclusions) — Task 4's UI change falls under that existing exclusion.
- **Known gap, explicitly flagged, not silently skipped**: Task 3's live end-to-end proxy behavior (real dev server + real backend, browser hitting `/api` through the proxy with zero CORS errors) was not confirmed in this session due to a test-harness process-lifecycle issue, not a discovered defect. Recommended before relying on it daily: `npm run dev` (real backend) + `./gradlew :composeApp:wasmJsBrowserDevelopmentRun` (kmp/) together, open the dev server URL, confirm the sidebar populates and the browser console shows no CORS errors.
- Task 3 itself has no unit tests by nature (declarative build config) — documented above rather than forced into an artificial test.

## Git checkpoints (this branch, `rebuild-using-kmp-v2`)

```
6fb9d44 feat: proxy /api and /ws through the wasmJs dev server to the real backend
aaf94ad fix: surface WebShellUiState.errorMessage instead of dropping it silently
18c5af2 feat: serve the compiled KMP Web build as the backend's static site
15f0dc4 test: add RED/GREEN for .wasm content type on static file serving
```
