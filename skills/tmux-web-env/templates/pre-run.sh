#!/usr/bin/env bash
# Runs before `docker compose up`, cwd = the session's worktree.
# Only include steps that must happen on the host before containers build/start.
set -euo pipefail

if [ -f .env.example ] && [ ! -f .env ]; then
  cp .env.example .env
fi
