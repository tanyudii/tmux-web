# CLAUDE.md

Guidance for Claude Code (or any future contributor) working in this repo.

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
