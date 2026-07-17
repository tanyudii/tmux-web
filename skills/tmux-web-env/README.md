# tmux-web-env (Claude Code skill)

Scaffolds a project's `.tmux-web-env/` folder so it gets a per-session,
Docker-isolated dev environment in [tmux-web](https://github.com/tanyudii/tmux-web)
(the **Setup Environment** button — see the main README's
"Per-session environments (docker-compose)" section for the full
mechanism this skill targets).

The tmux-web repo root also ships `.claude-plugin/marketplace.json` +
`.claude-plugin/plugin.json`, so the whole repo doubles as a one-plugin
Claude Code marketplace containing this skill.

## Install

### Option A: as a Claude Code plugin (recommended)

```
/plugin marketplace add tanyudii/tmux-web
/plugin install tmux-web@tmux-web
```

This repo is currently private, so this works with your own (or a
collaborator's) git/`gh` credentials — same access model as cloning it
for the "Local development" section in the main README. It does not
change the repo's visibility.

### Option B: copy the skill folder manually

Pick one, depending on whether you want it available in every project or
just one:

**Every project (user-level):**

```bash
cp -r skills/tmux-web-env ~/.claude/skills/tmux-web-env
```

**A single project only:**

```bash
cp -r skills/tmux-web-env <your-project>/.claude/skills/tmux-web-env
```

Either way, restart Claude Code (or start a new session) in the target
project, then invoke it — e.g. "set up a tmux-web environment for this
project". Claude Code auto-discovers skills and picks this one up by its
`description` when it's relevant, so an explicit invocation isn't
required either way.

## What it does

Reads `SKILL.md` in this folder — see it for the full contract. In short:
it inspects the target project's existing stack, then writes
`.tmux-web-env/docker-compose.yml` (required) and, only where actually
needed, `env.json`, `pre-run.sh`, and `post-run.sh`. It never runs
`docker compose up` itself — bringing the environment up per session is
tmux-web's job, done from its own UI.
