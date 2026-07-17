---
name: tmux-web-env
description: Scaffold a .tmux-web-env/ folder (docker-compose.yml, env.json, pre-run.sh, post-run.sh) so a project registered in tmux-web gets a per-session, Docker-isolated dev environment with a "Setup Environment" button in the UI. Use when the user wants to add tmux-web's per-session virtual environment to a project, mentions .tmux-web-env, or asks for isolated docker-compose environments per tmux-web session.
---

# tmux-web per-session environment setup

tmux-web (https://github.com/tanyudii/tmux-web) opts a project into a
per-session, Docker-isolated dev environment purely by the presence of a
`.tmux-web-env/` folder at the repo root. This skill scaffolds that folder
for the project currently open, tailored to its actual stack.

## The contract tmux-web expects

```
.tmux-web-env/
  docker-compose.yml   required -- its presence alone makes the "Setup
                        Environment" button appear in the tmux-web UI
  env.json              optional -- { "open": [{ "label"?, "service", "port" }] }
  pre-run.sh             optional -- runs before `docker compose up`, cwd = worktree
  post-run.sh             optional -- runs after `docker compose up`, cwd = worktree
```

When a user clicks **Setup Environment** on a session, tmux-web (not this
skill) runs: `pre-run.sh` (if present) → `docker compose up -d --build`
scoped with `-p <projectId>__<sessionSlug>` → `post-run.sh` (if present) →
resolves each `env.json` `open` entry's published port for an **Open ↗**
link. This skill only needs to produce files that behave correctly under
that flow — it never runs `docker compose up` itself.

## Steps

1. **Confirm the target project.** Default to the current working
   directory's git repo root. Do not assume it's the tmux-web repo itself
   — this skill is for *any* project a user registers in tmux-web.

2. **Inspect the existing stack** before writing anything:
   - Existing `docker-compose*.yml` / `Dockerfile` at the repo root (reuse
     instead of duplicating build logic where possible).
   - Manifest files (`package.json`, `pyproject.toml`, `go.mod`,
     `Gemfile`, `composer.json`, ...) to infer the main service's
     language/framework and its usual dev port.
   - `.env.example` / `.env.sample` (informs `pre-run.sh`).
   - Any existing migration/seed commands (informs `post-run.sh`).

3. **Determine services needed.** Usually: one "main app" service, plus
   optional dependencies (Postgres/MySQL/Redis/etc.) if the project
   already uses them in local dev. Ask the user only when genuinely
   ambiguous (e.g. which service should get the **Open ↗** link, or
   whether a database is actually needed) — don't ask about things
   already answered by what's in the repo.

4. **Write `.tmux-web-env/docker-compose.yml`.** See
   `templates/docker-compose.yml` for a minimal web+db starting point.
   Rules that are easy to get wrong — see Pitfalls below for why each one
   matters:
   - No top-level `name:` and no per-service `container_name:`.
   - Publish every host-facing port as `"127.0.0.1::<container-port>"`
     (ephemeral host port, loopback-only) — never a fixed host port.
   - `build.context` should resolve to the repo root relative to
     `.tmux-web-env/` (typically `context: ..`), reusing an existing
     `Dockerfile` if the repo has one.

5. **Write `env.json`** (only if at least one service should get an
   **Open ↗** link) using `templates/env.json` as the shape reference.
   Skip this file entirely if nothing needs a browser link.

6. **Write `pre-run.sh`** only if something must happen before `docker
   compose up` — e.g. `cp .env.example .env` if it doesn't exist yet.
   Skip it if there's nothing to do; don't ship an empty no-op script.
   `chmod +x` it.

7. **Write `post-run.sh`** only if migrations/seeding are actually needed
   after containers start. Have it wait/retry for the dependency's
   readiness rather than assuming the container is reachable the instant
   `docker compose up -d` returns. Skip it if not needed. `chmod +x` it.

8. **Validate without starting anything.** If `docker` and the `compose`
   v2 plugin are available locally, run
   `docker compose -f .tmux-web-env/docker-compose.yml config -q` to
   catch syntax errors. Never run `docker compose up` yourself — bringing
   containers up is tmux-web's job, scoped per session, not this skill's.

9. **Summarize and remind the user:**
   - Commit `.tmux-web-env/` — it's meant to be versioned like the rest
     of the repo, and can differ per branch.
   - Docker-group membership is root-equivalent on most default installs;
     enabling this feature on a project is equivalent to trusting
     whoever's running tmux-web with root on that host.
   - Existing/older sessions need **Setup Environment** re-run to pick up
     a changed `docker-compose.yml` — there's no file-watch/auto-reload.

## Pitfalls

- **Don't set `container_name:` or a compose `name:`.** tmux-web supplies
  `-p <projectId>__<sessionSlug>` at `docker compose up` time so each
  session's containers, network, and volumes stay isolated from every
  other session of the same project. A fixed name defeats that and makes
  a second concurrent session collide with the first.
- **Never use a fixed host port** (e.g. `"3000:3000"`). Two sessions of
  the same project (or two different projects) will fight over it.
  Always `"127.0.0.1::<container-port>"` and let tmux-web resolve the
  actual published port via `docker compose port`.
- **`pre-run.sh`/`post-run.sh` run with the session's worktree as their
  working directory** — a fresh `git worktree`, not tmux-web's own
  install directory and not necessarily the directory this skill was
  invoked from.
- **The folder's presence is the entire opt-in mechanism** — there is no
  separate registration step in the tmux-web UI. Don't add
  `.tmux-web-env/` to a project the user doesn't want this feature on.
- **This is inert without `docker` + the `compose` v2 plugin** on the
  machine actually running tmux-web (not necessarily the machine this
  skill runs on) — say so if you can't verify it's installed.

## Reference templates

`templates/docker-compose.yml`, `templates/env.json`,
`templates/pre-run.sh`, and `templates/post-run.sh` in this skill's
folder are minimal, adaptable starting points — read them before writing
the project's actual files, then adjust service names, ports, and
commands to match what was found in step 2.
