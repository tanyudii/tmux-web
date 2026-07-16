# CLAUDE.md

Guidance for Claude Code (or any future contributor) working in this repo.

## Mandatory: verify KMP web UI changes live before reporting them done

Explicit standing instruction from the repo owner (2026-07-15), after a
`RenameWindowDialog` change shipped without live verification and left the
app completely stuck (couldn't type or click anything, required a page
refresh to recover) the first time it was actually used.

**Compile + detekt + unit tests passing is not sufficient evidence that a
Compose Multiplatform Web UI change works.** This codebase has already hit
multiple bugs that only exist at runtime in a real browser and are
invisible to the Kotlin/Gradle toolchain: the `instanceof XtermTerminal`
JS-interop naming mismatch, the `fitAddon.fit()` 0x0 layout race, the
silently-dropped resize-before-WebSocket-open bug, and native interop DOM
views (xterm.js) always painting over -- or, per this incident, potentially
still capturing focus/clicks despite -- Compose `Popup`/`Dialog` content.
None of these were catchable by `./gradlew build`.

Before telling the user a UI-affecting change (new dialog, new interactive
control, layout change, anything touching `PlatformTerminalView`'s
`isVisible` or focus) is done:

1. Rebuild the wasmJs bundle (`./gradlew :composeApp:wasmJsBrowserDistribution`).
2. Drive it with a real headless Chromium against the running dev instance
   (see the `run` skill / prior session transcripts for the Playwright +
   cached-Chromium-binary setup used so far -- `playwright-core` pointed at
   `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`, since this
   sandbox has no `wasmJsTest`-compatible Chrome for Karma).
3. Actually interact with the new thing the way a user would -- click it,
   type into it, screenshot it -- not just load the page and confirm no
   console errors. A dialog that renders but can't be typed into or
   dismissed is a shippable-looking failure that only a real interaction
   catches.
4. Only report the change as working after that interaction succeeds. If
   verification is skipped for cost/time reasons, say so explicitly to the
   user instead of implying it was checked.

## Do not reintroduce `npm install -g github:tanyudii/tmux-web#<tag>`

This was the original install/upgrade mechanism and it is permanently broken
on Node.js 22 for this package. Two independent bugs, either one enough on
its own:

1. **npm/pacote private-repo bug.** For a GitHub-hosted git dependency, npm
   always tries a fast HTTPS tarball shortcut
   (`https://codeload.github.com/{owner}/{repo}/tar.gz/{sha}`) before
   falling back to a real git clone -- regardless of whether you pass the
   `github:` shorthand or an explicit `git+ssh://` URL. For a private repo
   this 404s, and the fallback to git-protocol extraction does not happen
   correctly: the package directory never gets created under
   `node_modules`, and a nested dependency's install script (`node-pty`)
   then fails with a confusing, unrelated-looking `ENOENT: spawn /bin/sh`
   (actually caused by the missing `cwd`, not a missing shell).
2. **Node 22 hard restriction, independent of bug 1.** Even when a global
   npm install *does* succeed in placing `tmux-web` under `node_modules`,
   Node throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` and refuses to
   run `bin/tmuxweb.ts` -- Node blocks native TypeScript type-stripping for
   any file physically located inside a directory literally named
   `node_modules`, with **no override flag**
   (`--experimental-strip-types`/`--experimental-transform-types` both
   fail identically). Since npm always installs into some `node_modules`
   folder, `npm install -g` of this raw-`.ts`-shipping package can never
   work on Node 22 -- for any repo, public or private.

Both bugs were root-caused live (not guesswork) while deploying v1.0.2 to a
real server. Do not "fix" install/upgrade by reverting to `npm install -g
github:...` or `npm install -g git+ssh://...` -- it will fail the same way.

Adding a TypeScript build step (compiling to `dist/*.js`) would only fix bug
2, not bug 1, and was deliberately rejected to preserve this project's
stated "no build step, no `dist/` to keep in sync with source" design goal
(see README "Requirements on the host machine").

## The actual install/upgrade architecture

Code and runtime data live in two deliberately separate places:

- **`~/.local/share/tmux-web`** (XDG convention) -- tmux-web's own code, a
  git clone of a tagged commit, kept **outside any `node_modules`
  directory** so bug 2 above never applies. Installed/updated via
  `git clone`/`git fetch` over SSH directly (bug 1 above never applies,
  since npm's git-spec resolution is never invoked) + `npm ci --omit=dev` +
  `npm link`.
- **`~/.tmux-web`** (`src/config.ts`'s `defaultConfigDir()`) -- runtime data
  only: `config.json` (token/port/host), `projects.json`, worktrees. Never
  code. Never touched by install/upgrade.

`src/cli/upgrade.ts` is the source of truth for this mechanism:

- `cloneOrUpdateAppDir()` -- clones fresh if `~/.local/share/tmux-web`
  doesn't exist yet or isn't a matching clone; otherwise does a shallow
  `git fetch` of exactly the target tag + `git checkout --force` in place
  (self-healing: also repairs a clone left corrupted by a killed previous
  upgrade).
- `npmInstallAndLink()` -- `npm ci --omit=dev` then `npm link`, both run
  with `cwd` set to the app dir.
- `downloadWebBuild()` -- downloads the target tag's prebuilt KMP web
  (wasmJs) bundle from a GitHub Release asset via the `gh` CLI (auth is
  `gh`'s problem, not this codebase's -- see README's "Requirements on the
  host machine") and extracts it to
  `<appDir>/kmp/composeApp/build/dist/wasmJs/productionExecutable`, the
  exact path `src/main.ts`'s `DEFAULT_WEB_BUILD_DIR` reads from. Failure
  here is non-fatal (same pattern as `refreshService` below) -- it warns
  and leaves the server running API-only via `web-build.ts`'s existing
  graceful-degrade path, it never aborts the upgrade.
- `runUpgrade()` -- wires the above together, resolves `--tag`/`--app-dir`,
  re-execs into the freshly-installed code (see the re-exec section below)
  before downloading the web build and restarting the systemd `--user`
  service if it was already running.

`src/cli/service-command.ts`'s `resolveBinPath()` and `src/cli/version.ts`'s
`readPackageVersion()` both resolve paths relative to their own
`import.meta.url` rather than `process.cwd()`/`node_modules` -- this is
already correct for the app-dir model above and needs no changes.

The user-facing version of this is documented in `README.md` under
**Installation (global CLI, production)** and **Upgrading** -- keep those
sections in sync with `upgrade.ts` if the mechanism changes.

## A running `tmuxweb upgrade` process can't apply its own code changes -- fixed via re-exec

Learned the hard way shipping v1.1.0/v1.1.1: when `tmuxweb upgrade` updates
`~/.local/share/tmux-web` on disk and then calls back into
`service-command.ts` (via `refreshService` in `upgrade.ts`) to regenerate
the systemd unit, it used the **already-loaded, in-memory** version of
`service-command.ts` -- i.e. whatever code was running when that
`tmuxweb upgrade` invocation started, NOT the newly-installed version that
was just written to disk. Node doesn't hot-reload a module that's already
imported, even though the file on disk changed underneath it. The exact
same gotcha applied to `downloadWebBuild()` (added for the KMP web bundle):
the first `tmuxweb upgrade` run after that feature shipped cloned the new
`upgrade.ts` to disk but kept executing the OLD in-memory code, so
`downloadWebBuild()` never actually got called that run.

**Fixed by re-exec**: `runUpgrade()` now does `cloneOrUpdateAppDir()` +
`npmInstallAndLink()` (bringing the code on disk up to date), then --
unless `isReexecChild` is already set -- spawns a **fresh child process**
(`spawn`/`defaultSpawn`, `stdio: "inherit"` so the child's own
console output streams straight through) running
`<appDir>/bin/tmuxweb.ts upgrade --tag <tag> --app-dir <appDir>` with
`TMUX_WEB_UPGRADE_REEXEC=1` set on its env, and returns once that child
exits (throwing `UpgradeError` on a non-zero exit code). That child is a
brand-new Node process, so it loads `bin/tmuxweb.ts` → `upgrade.ts` →
`service-command.ts` fresh from the just-updated disk -- no stale
in-memory code anywhere. The child sees `isReexecChild = true` (read from
the env var by `resolveUpgradeDeps()` when the caller doesn't override it)
and skips straight to `downloadWebBuild()` + the systemd
refresh-and-restart, i.e. exactly the code that was just installed. One
`tmuxweb upgrade` invocation is now sufficient end-to-end for *any* future
release, including ones that change `buildUnit()`/`installService()` or
`downloadWebBuild()` itself.

**Bootstrapping caveat, inherent and unavoidable**: this only fixes
upgrades *from* a version that already has the re-exec mechanism. A server
still running a pre-re-exec `upgrade.ts` has no way to know about
re-exec'ing at all -- its `tmuxweb upgrade` will run the old single-process
flow exactly as before (self-consistent for whatever it already knows how
to do, just without the fix). One such upgrade is enough to land the
re-exec-enabled code on disk; every `tmuxweb upgrade` after that is
reliably single-invocation. This is the same one-time bootstrap gap any
self-updating CLI has for a fix to its own update mechanism -- there's no
way to retroactively patch code that hasn't been fetched yet.

## Testing this mechanism

`src/cli/upgrade.test.ts` has both fully-mocked unit tests (exec calls
recorded via a local `recordingExec` helper) and two real-process
integration tests (gated by `isGitAvailable()` for the git one; the npm one
has no gate since the whole test suite already requires npm to run):

- A real-git test exercises `cloneOrUpdateAppDir()` directly against a
  throwaway local origin repo with two tags, asserting a fresh clone lands
  on tag 1's content and a subsequent call with tag 2 updates in place via
  fetch+checkout (not a re-clone).
- A real-npm test exercises `npmInstallAndLink()` directly against a
  minimal synthetic fixture package, asserting a real symlink lands outside
  `node_modules` at a temporary `npm_config_prefix`.

These exist because a 100%-mocked test suite is exactly what let the
original `npm install -g github:...` bug ship invisibly -- mocks would
happily "pass" even with the wrong command. Keep both real-process tests if
you touch this code again; don't reduce coverage back to mocks-only.

The re-exec mechanism itself has the same "mocks would happily pass either
way" risk for the one thing that actually matters -- does `defaultSpawn`
really wait for a real child process and really return its real exit
code? -- so `defaultSpawn` gets two real-process tests of its own (spawning
`node -e "process.exit(N)"` and asserting the returned code, and asserting
an injected `env` value round-trips into the child). `runUpgrade`'s own
re-exec *branching* logic (spawn called with the right args and env,
`isReexecChild` skipping straight to the download/refresh continuation, a
non-zero child exit surfacing as `UpgradeError`) stays mocked, same as
every other `runUpgrade` test -- the branching logic itself has nothing
process-real to get wrong.

`downloadWebBuild()`'s `gh` call is deliberately **not** covered by a
real-process test the way `git`/`npm` are: unlike a local git remote or an
npm install against a synthetic local fixture, `gh` unavoidably needs
network + auth (`gh auth login`/`GH_TOKEN`), which can't be assumed in
every dev sandbox or CI job. Instead, the real-process coverage here
exercises the actually-mock-invisible risk -- the nested-path extraction
math -- by building a real gzip tarball fixture, feeding it through a
stubbed `gh` (that just drops the fixture where a real download would)
into a **real** `tar` extraction, then asserting the result lands exactly
where `web-build.ts`'s `resolveWebBuildDir()` looks for it. `gh` itself is
covered by mocked unit tests only.

## Cutting a release

Releases are cut by the **Release** workflow (`.github/workflows/release.yml`),
two ways:

1. **Manual**, from the Actions tab: pick a bump level (patch/minor/major).
2. **Automatic**, on every push to `main`: the workflow's `determine-release`
   job scans every commit since the latest `v*.*.*` tag for Conventional
   Commits prefixes and picks the bump level itself -- any `type!:` or
   `BREAKING CHANGE` footer -> major, else any `feat:` -> minor, else any
   `fix:` -> patch, else (only `chore`/`docs`/`refactor`/`test`/`ci`/`style`
   commits landed since the last tag) -> **no release at all**, not even an
   empty patch bump. This relies on the repo's existing squash-merge
   convention (one PR = one commit on `main`) and its already-consistent use
   of these prefixes -- see recent `git log --oneline` for real examples.

Either way, the `release` job (gated behind `determine-release` actually
deciding to release) reads the latest `v*.*.*` tag, increments it, bumps
`package.json` + `package-lock.json` (the three `tmux-web` version fields
only -- top-level in both files plus `packages[""].version` in the
lockfile), runs typecheck + the full test suite as a gate, then commits
`chore: release vX.Y.Z`, creates a lightweight tag, and pushes both to
`main`. It refuses to run off `main`.

**Why the auto-trigger doesn't loop on itself**: the release job's
`chore: release vX.Y.Z` push uses the default `GITHUB_TOKEN`, and pushes
authenticated that way do not re-trigger `on: push` workflow runs (a
deliberate GitHub Actions safeguard) -- so the release commit landing on
`main` does not cause `determine-release` to run again for it.

The version is computed from the latest *tag* (not `package.json`), matching
what `tmuxweb upgrade`'s `resolveLatestTag()` resolves (`git ls-remote --tags
--sort=-v:refname`), so a new release always advances past the tag
`tmuxweb upgrade` would install. Tags stay lightweight (`vX.Y.Z`, no `-a`) to
match the existing v1.x convention.

To cut a release by hand instead (e.g. the workflow is broken): bump the three
version fields, commit `chore: release vX.Y.Z`, `git tag vX.Y.Z`, push both.

The Release workflow also builds the KMP web (wasmJs) production bundle
(`./gradlew :composeApp:wasmJsBrowserDistribution` in `kmp/`, same JDK
21/Gradle setup as `kmp-ci.yml`), tars it as `kmp-web.tar.gz`, and attaches
it to the GitHub Release for the new tag via `gh release create` -- this is
what `tmuxweb upgrade`'s `downloadWebBuild()` fetches on the server (see
"The actual install/upgrade architecture" above). The build runs *before*
the version bump/commit/tag/push step, so a broken `kmp/` fails the
workflow cleanly with nothing pushed to `main` and no tag created, rather
than leaving a dangling released-looking tag with no working web UI asset.
This build is intentionally **not** re-run through `kmp-ci.yml`'s
`detekt`/`wasmJsTest`/`koverVerify` gate -- it trusts `main`'s already-green
`kmp-ci.yml` run (which runs on every push touching `kmp/**`) plus the
implicit smoke test that a broken `kmp/` fails `wasmJsBrowserDistribution`
outright rather than shipping silently.

## Clipboard paste into Web text fields is impossible on insecure origins -- not a Compose bug, not fixable in-app

Investigated live (headless Chromium, real Ctrl+V/right-click/`execCommand`
round trips, not guesswork) after a report that the Connect screen's Access
token field "can't paste". The obvious suspects were both wrong: it is not
a secure-context issue *specific to Ctrl+V being unwired* (an earlier draft
of this investigation concluded that, then had to retract it -- see below),
and it is not a Compose Multiplatform Web bug at all.

**What actually happens, confirmed live:**
- On a secure origin (`https://`, or `http://localhost`/`127.0.0.1`)
  Ctrl+V paste, and right-click "Paste" from Compose's own context menu,
  both work correctly -- including replacing an active selection. An
  earlier pass of this same investigation used Playwright to fire
  `Ctrl+A` immediately followed by `Ctrl+V` with zero delay between the
  two key events and saw the paste silently no-op, and wrongly concluded
  Ctrl+V wasn't wired to Compose's paste action at all. That's a
  synthetic-automation artifact, not a real bug: no human keyboard user
  produces true 0ms between two chorded shortcuts. Re-running the exact
  same sequence with a realistic ~80ms gap between the two key presses
  pastes correctly every time. If you're debugging input issues here with
  Playwright/CDP, budget a small delay between distinct key presses or you
  will chase phantom bugs like this one.
- On an insecure origin (plain HTTP on anything other than
  localhost/127.0.0.1 -- e.g. this project's own recommended
  WireGuard/Tailscale-tunnel deployment, see the README and
  `XtermJs.kt`'s `copyTextToClipboard` comment) paste is **completely
  unavailable, full stop**: `navigator.clipboard` does not exist on
  `window` at all, Compose's own context menu omits the "Paste" item
  entirely (only "Select all" remains -- Compose itself detects this and
  adapts), and the legacy `document.execCommand("paste")` fallback
  returns `false` (blocked by the browser; unlike `execCommand("copy")`,
  which browsers still allow and which is why the terminal's own
  Cmd+C-to-clipboard feature works fine on the same insecure origins).
  There is no JS-level workaround for reading the clipboard on paste here
  -- this is a hard browser platform restriction, identical in spirit to
  why `navigator.clipboard.writeText` needs a secure context for the
  terminal's copy feature, just on the read side instead of write.

**What shipped instead of a paste "fix" (because there is no code fix for
the real-world case):** `domain/SecureContext.kt`'s `isSecureContext()`
expect/actual (wasmJs actual reads `window.isSecureContext`; jvm/ios
actuals return `true`, since neither has this restriction) feeds
`ConnectionSettingsUiState.pasteRestricted`, which `SettingsScreen.kt`
surfaces as a helper hint under the Access token field on insecure
origins: "Clipboard paste isn't available on this connection (needs
HTTPS or localhost) -- type the token instead." Separately (and
independent of the paste investigation), `domain/DefaultServerUrl.kt`'s
`defaultServerUrl()` expect/actual prefills the Server URL field from
`window.location.origin` on wasmJs (null/unchanged on jvm/ios) -- since
`src/main.ts` always serves the API and this Compose bundle from the same
origin, this removes the *need* to type or paste the Server URL at all,
leaving only the Access token as something that must be typed by hand on
an insecure-origin deployment.
