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
  restarts the systemd `--user` service if it was already running.

`src/cli/service-command.ts`'s `resolveBinPath()` and `src/cli/version.ts`'s
`readPackageVersion()` both resolve paths relative to their own
`import.meta.url` rather than `process.cwd()`/`node_modules` -- this is
already correct for the app-dir model above and needs no changes.

The user-facing version of this is documented in `README.md` under
**Installation (global CLI, production)** and **Upgrading** -- keep those
sections in sync with `upgrade.ts` if the mechanism changes.

## A running `tmuxweb upgrade` process can't apply its own code changes

Learned the hard way shipping v1.1.0/v1.1.1: when `tmuxweb upgrade` updates
`~/.local/share/tmux-web` on disk and then calls back into
`service-command.ts` (via `refreshService` in `upgrade.ts`) to regenerate
the systemd unit, it uses the **already-loaded, in-memory** version of
`service-command.ts` -- i.e. whatever code was running when that
`tmuxweb upgrade` invocation started, NOT the newly-installed version that
was just written to disk. Node doesn't hot-reload a module that's already
imported, even though the file on disk changed underneath it.

Practical effect: any release that changes what `buildUnit()` produces
(v1.1.0 added the `start` argument to `ExecStart`; v1.1.1 removed
`ProtectSystem=strict`) does NOT take full effect on the upgrade that
introduces it -- `tmuxweb upgrade`'s own unit-refresh step still writes
the OLD unit shape that upgrade. It only takes effect starting with the
NEXT `tmuxweb upgrade` (or any other fresh `tmuxweb` invocation, e.g.
`tmuxweb service install` run by hand), because that starts a brand new
process which loads the already-updated files fresh from disk.

If you ship another `buildUnit()`/`installService()` change: after
upgrading a server past that release, run `tmuxweb service install`
by hand once (a fresh process) to force the corrected unit into place
immediately, then `systemctl --user restart tmux-web` -- systemd
sandboxing directives like `ProtectSystem` apply at process start, so an
already-running process stays under the old sandbox until restarted even
after the unit file itself is rewritten. Don't assume the self-refresh
mechanism alone is sufficient on the very first upgrade past such a
change.

The exact same gotcha applies to `downloadWebBuild()` (added for the KMP
web bundle -- see above): the very first `tmuxweb upgrade` run *after* that
feature ships will clone the new `upgrade.ts` to disk, but this invocation
is still executing the OLD in-memory code that was already running when it
started -- so `downloadWebBuild()` doesn't actually get called yet. Only
the *next* `tmuxweb upgrade` (a fresh process, loading the new code from
disk) will really fetch the web UI bundle for the first time. Not a bug;
just don't expect the web UI to appear after only one upgrade the first
time this ships to an existing install.

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
triggered manually from the Actions tab: pick a bump level (patch/minor/major)
and it reads the latest `v*.*.*` tag, increments it, bumps `package.json` +
`package-lock.json` (the three `tmux-web` version fields only -- top-level in
both files plus `packages[""].version` in the lockfile), runs typecheck + the
full test suite as a gate, then commits `chore: release vX.Y.Z`, creates a
lightweight tag, and pushes both to `main`. It refuses to run off `main`.

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
