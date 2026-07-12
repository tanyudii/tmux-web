import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listProjectSessions,
  createProjectSession,
  killProjectSession,
  type ProjectSessionsDeps,
} from "./project-sessions.ts";
import type { Project } from "./projects.ts";
import { ValidationError } from "./tmux.ts";
import { WorktreeConflictError } from "./worktree.ts";

const PROJECT: Project = {
  id: "proj1-ab12cd",
  name: "My Project",
  repoPath: "/repo",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeDeps(overrides: Partial<ProjectSessionsDeps> = {}): ProjectSessionsDeps {
  return {
    listSessions: async () => [],
    createSession: async () => {},
    killSession: async () => {},
    addWorktree: async () => {},
    removeWorktree: async () => {},
    worktreesRoot: "/data/worktrees",
    ...overrides,
  };
}

test("listProjectSessions returns only sessions belonging to the project, with the prefix stripped", async () => {
  const deps = makeDeps({
    listSessions: async () => [
      { name: "proj1-ab12cd__feature-x", windows: 2, attached: true },
      { name: "other-project__feature-y", windows: 1, attached: false },
      { name: "proj1-ab12cd__bugfix", windows: 1, attached: false },
    ],
  });

  const result = await listProjectSessions(PROJECT, deps);

  assert.deepEqual(result, [
    { name: "feature-x", fullName: "proj1-ab12cd__feature-x", windows: 2, attached: true },
    { name: "bugfix", fullName: "proj1-ab12cd__bugfix", windows: 1, attached: false },
  ]);
});

test("listProjectSessions returns an empty array when nothing belongs to the project", async () => {
  const deps = makeDeps({ listSessions: async () => [{ name: "other__x", windows: 1, attached: false }] });
  assert.deepEqual(await listProjectSessions(PROJECT, deps), []);
});

test("createProjectSession slugifies the name, creates the worktree, then the tmux session with cwd set", async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    addWorktree: async (repoPath, worktreePath, branchName) => {
      calls.push(`addWorktree:${repoPath}:${worktreePath}:${branchName}`);
    },
    createSession: async (name, options) => {
      calls.push(`createSession:${name}:${options?.cwd}`);
    },
  });

  const result = await createProjectSession(PROJECT, "My Feature!", deps);

  assert.equal(result.name, "my-feature");
  assert.equal(result.fullName, "proj1-ab12cd__my-feature");
  assert.deepEqual(calls, [
    "addWorktree:/repo:/data/worktrees/proj1-ab12cd/my-feature:my-feature",
    "createSession:proj1-ab12cd__my-feature:/data/worktrees/proj1-ab12cd/my-feature",
  ]);
});

test("createProjectSession throws ValidationError when the name has nothing sluggable", async () => {
  await assert.rejects(() => createProjectSession(PROJECT, "!!!", makeDeps()), ValidationError);
});

test("createProjectSession rolls back the worktree if creating the tmux session fails", async () => {
  const removeCalls: Array<{ path: string; force?: boolean }> = [];
  const deps = makeDeps({
    createSession: async () => {
      throw new Error("tmux exploded");
    },
    removeWorktree: async (_repoPath, worktreePath, options) => {
      removeCalls.push({ path: worktreePath, force: options?.force });
    },
  });

  await assert.rejects(() => createProjectSession(PROJECT, "feature-x", deps), /tmux exploded/);
  assert.deepEqual(removeCalls, [{ path: "/data/worktrees/proj1-ab12cd/feature-x", force: true }]);
});

test("createProjectSession propagates WorktreeConflictError from addWorktree", async () => {
  const deps = makeDeps({
    addWorktree: async () => {
      throw new WorktreeConflictError("branch already exists");
    },
  });

  await assert.rejects(() => createProjectSession(PROJECT, "feature-x", deps), WorktreeConflictError);
});

test("killProjectSession kills the tmux session then removes the worktree", async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    killSession: async (name) => {
      calls.push(`kill:${name}`);
    },
    removeWorktree: async (repoPath, worktreePath, options) => {
      calls.push(`remove:${repoPath}:${worktreePath}:${options?.force ?? false}`);
    },
  });

  await killProjectSession(PROJECT, "feature-x", deps);

  assert.deepEqual(calls, [
    "kill:proj1-ab12cd__feature-x",
    "remove:/repo:/data/worktrees/proj1-ab12cd/feature-x:false",
  ]);
});

test("killProjectSession passes the force option through to removeWorktree", async () => {
  const deps = makeDeps();
  const calls: boolean[] = [];
  deps.removeWorktree = async (_repoPath, _worktreePath, options) => {
    calls.push(Boolean(options?.force));
  };

  await killProjectSession(PROJECT, "feature-x", deps, { force: true });

  assert.deepEqual(calls, [true]);
});

test("killProjectSession tolerates the tmux session already being gone", async () => {
  const removeCalls: string[] = [];
  const deps = makeDeps({
    killSession: async () => {
      throw new Error("can't find session: proj1-ab12cd__feature-x");
    },
    removeWorktree: async (_repoPath, worktreePath) => {
      removeCalls.push(worktreePath);
    },
  });

  await killProjectSession(PROJECT, "feature-x", deps, { force: true });

  assert.deepEqual(removeCalls, ["/data/worktrees/proj1-ab12cd/feature-x"]);
});

test("killProjectSession tolerates the tmux server having shut down entirely (last session was already killed)", async () => {
  // tmux's own server process exits once its last session dies, so a
  // force-retry after that can hit "no server running" instead of
  // "can't find session" -- both mean "there's nothing left to kill".
  const removeCalls: string[] = [];
  const deps = makeDeps({
    killSession: async () => {
      throw new Error("no server running on /tmp/tmux-1000/default");
    },
    removeWorktree: async (_repoPath, worktreePath) => {
      removeCalls.push(worktreePath);
    },
  });

  await killProjectSession(PROJECT, "feature-x", deps, { force: true });

  assert.deepEqual(removeCalls, ["/data/worktrees/proj1-ab12cd/feature-x"]);
});

test("killProjectSession rethrows unexpected killSession errors", async () => {
  const deps = makeDeps({
    killSession: async () => {
      throw new Error("permission denied");
    },
  });

  await assert.rejects(() => killProjectSession(PROJECT, "feature-x", deps), /permission denied/);
});
