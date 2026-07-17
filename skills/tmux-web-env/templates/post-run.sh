#!/usr/bin/env bash
# Runs after `docker compose up -d --build`, cwd = the session's worktree.
# Containers were just started -- wait for readiness before assuming a
# dependency (e.g. the database) is actually reachable.
set -euo pipefail

until docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

docker compose exec -T web npm run migrate --if-present
