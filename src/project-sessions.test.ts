import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listProjectSessions,
  createProjectSession,
  startProjectSessionCreation,
  getSessionCreationStatus,
  createSessionCreationStore,
  killProjectSession,
  killProjectSessionSplit,
  isProjectSessionBranchMerged,
  getProjectSessionPasteBuffer,
  getProjectSessionChanges,
  getProjectSessionDiff,
  stageProjectSessionFile,
  unstageProjectSessionFile,
  discardProjectSessionFile,
  commitProjectSessionChanges,
  SessionCreationInProgressError,
  SessionCreationNotFoundError,
  type ProjectSessionsDeps,
  type SessionCreationStatus,
} from "./project-sessions.ts";
import type { Project } from "./projects.ts";
import type { GroupedChanges } from "./git-status.ts";
import { ValidationError } from "./tmux.ts";
import { WorktreeConflictError } from "./worktree.ts";
import { splitPaneSessionName } from "./session-naming.ts";

const PROJECT: Project = {
  id: "proj1-ab12cd",
  name: "My Project",
  repoPath: "/repo",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeDeps(overrides: Partial<ProjectSessionsDeps> = {}): ProjectSessionsDeps {
  return {
    listSessions: async () => [],
    listWindows: async () => [],
    createSession: async () => {},
    killSession: async () => {},
    sendKeys: async () => {},
    addWorktree: async () => {},
    removeWorktree: async () => {},
    isBranchMerged: async () => true,
    deleteBranch: async () => {},
    readPasteBuffer: async () => "",
    getChangedFiles: async () => ({ staged: [], unstaged: [], untracked: [], conflicted: [], repoState: "clean" }),
    getFileDiff: async () => ({ diff: "", isUntracked: false, isBinary: false }),
    stageFile: async () => {},
    unstageFile: async () => {},
    discardFile: async () => {},
    commitStaged: async () => {},
    listEnvFiles: async () => [],
    readEnvFile: async () => "",
    writeEnvFile: async () => {},
    worktreesRoot: "/data/worktrees",
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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
    {
      name: "feature-x",
      fullName: "proj1-ab12cd__feature-x",
      windows: 2,
      windowNames: [],
      attached: true,
      label: undefined,
      favorite: false,
    },
    {
      name: "bugfix",
      fullName: "proj1-ab12cd__bugfix",
      windows: 1,
      windowNames: [],
      attached: false,
      label: undefined,
      favorite: false,
    },
  ]);
});

test("listProjectSessions returns an empty array when nothing belongs to the project", async () => {
  const deps = makeDeps({ listSessions: async () => [{ name: "other__x", windows: 1, attached: false }] });
  assert.deepEqual(await listProjectSessions(PROJECT, deps), []);
});

test("listProjectSessions fills in each session's real per-window tmux names, ordered by index", async () => {
  const deps = makeDeps({
    listSessions: async () => [{ name: "proj1-ab12cd__feature-x", windows: 2, attached: true }],
    listWindows: async (fullName) => {
      assert.equal(fullName, "proj1-ab12cd__feature-x");
      return [
        { index: 0, name: "editor" },
        { index: 1, name: "server" },
      ];
    },
  });

  const result = await listProjectSessions(PROJECT, deps);

  assert.deepEqual(result[0].windowNames, ["editor", "server"]);
});

test("listProjectSessions attaches label/favorite from listSessionMeta, looked up by session slug", async () => {
  const deps = makeDeps({
    listSessions: async () => [
      { name: "proj1-ab12cd__feature-x", windows: 1, attached: true },
      { name: "proj1-ab12cd__bugfix", windows: 1, attached: false },
    ],
    listSessionMeta: async (projectId) => {
      assert.equal(projectId, PROJECT.id);
      return [{ projectId, sessionSlug: "feature-x", label: "Important", favorite: true }];
    },
  });

  const result = await listProjectSessions(PROJECT, deps);

  assert.equal(result[0].label, "Important");
  assert.equal(result[0].favorite, true);
  assert.equal(result[1].label, undefined);
  assert.equal(result[1].favorite, false);
});

test("listProjectSessions defaults label/favorite when listSessionMeta isn't wired up", async () => {
  const deps = makeDeps({
    listSessions: async () => [{ name: "proj1-ab12cd__feature-x", windows: 1, attached: true }],
  });

  const result = await listProjectSessions(PROJECT, deps);

  assert.equal(result[0].label, undefined);
  assert.equal(result[0].favorite, false);
});

test("listProjectSessions omits windowNames for a session whose window list can't be fetched", async () => {
  const deps = makeDeps({
    listSessions: async () => [{ name: "proj1-ab12cd__feature-x", windows: 1, attached: true }],
    listWindows: async () => {
      throw new Error("can't find session");
    },
  });

  const result = await listProjectSessions(PROJECT, deps);

  assert.equal(result[0].windowNames, undefined);
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

test("createProjectSession records a 'created' event after the session is created", async () => {
  const calls: Array<[string, string, string]> = [];
  const deps = makeDeps({
    recordEvent: async (projectId, sessionSlug, type) => {
      calls.push([projectId, sessionSlug, type]);
    },
  });

  await createProjectSession(PROJECT, "feature-x", deps);

  assert.deepEqual(calls, [["proj1-ab12cd", "feature-x", "created"]]);
});

test("createProjectSession swallows a recordEvent failure -- session creation still succeeds", async () => {
  const deps = makeDeps({
    recordEvent: async () => {
      throw new Error("disk full");
    },
  });

  const result = await createProjectSession(PROJECT, "feature-x", deps);

  assert.equal(result.fullName, "proj1-ab12cd__feature-x");
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

test("createProjectSession sends the startup command as keystrokes to the new session after it's created", async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    createSession: async (name) => {
      calls.push(`createSession:${name}`);
    },
    sendKeys: async (name, text) => {
      calls.push(`sendKeys:${name}:${text}`);
    },
  });

  await createProjectSession(PROJECT, "feature-x", deps, undefined, "npm run dev");

  assert.deepEqual(calls, ["createSession:proj1-ab12cd__feature-x", "sendKeys:proj1-ab12cd__feature-x:npm run dev"]);
});

test("createProjectSession never calls sendKeys when no startup command is given", async () => {
  let called = false;
  const deps = makeDeps({
    sendKeys: async () => {
      called = true;
    },
  });

  await createProjectSession(PROJECT, "feature-x", deps);

  assert.equal(called, false);
});

test("createProjectSession swallows a sendKeys failure -- session creation still succeeds", async () => {
  const deps = makeDeps({
    sendKeys: async () => {
      throw new Error("tmux send-keys exploded");
    },
  });

  const result = await createProjectSession(PROJECT, "feature-x", deps, undefined, "npm run dev");

  assert.equal(result.fullName, "proj1-ab12cd__feature-x");
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

  // The split pane's linked session (see splitPaneSessionName) is killed
  // first, best-effort, before the primary session -- see killProjectSession's
  // own doc comment.
  assert.deepEqual(calls, [
    `kill:${splitPaneSessionName("proj1-ab12cd__feature-x")}`,
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

test("killProjectSession records a 'deleted' event after the worktree is removed", async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    removeWorktree: async () => {
      calls.push("removeWorktree");
    },
    recordEvent: async (_projectId, _sessionSlug, type) => {
      calls.push(`recordEvent:${type}`);
    },
  });

  await killProjectSession(PROJECT, "feature-x", deps);

  assert.deepEqual(calls, ["removeWorktree", "recordEvent:deleted"]);
});

test("killProjectSession does not delete the branch by default", async () => {
  let called = false;
  const deps = makeDeps({
    deleteBranch: async () => {
      called = true;
    },
  });

  await killProjectSession(PROJECT, "feature-x", deps);

  assert.equal(called, false);
});

test("killProjectSession force-deletes the branch when deleteBranch is true, after the worktree is removed", async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    removeWorktree: async () => {
      calls.push("removeWorktree");
    },
    deleteBranch: async (repoPath, branchName) => {
      calls.push(`deleteBranch:${repoPath}:${branchName}`);
    },
  });

  await killProjectSession(PROJECT, "feature-x", deps, { deleteBranch: true });

  assert.deepEqual(calls, ["removeWorktree", "deleteBranch:/repo:feature-x"]);
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

test("killProjectSession tears down the session's docker-compose environment before killing tmux and removing the worktree", async () => {
  // stopSessionEnv runs first (not killSession) so a slow `docker compose
  // down -v` doesn't leave the client's attached /ws closed -- and looking
  // like an unexpected drop -- for the whole rest of this request. See the
  // comment in killProjectSession for the full rationale.
  const calls: string[] = [];
  const deps = makeDeps({
    killSession: async () => {
      calls.push("kill");
    },
    stopSessionEnv: async (project, sessionSlug) => {
      calls.push(`stopEnv:${project.id}:${sessionSlug}`);
    },
    removeWorktree: async () => {
      calls.push("remove");
    },
  });

  await killProjectSession(PROJECT, "feature-x", deps);

  // Two "kill" entries: the split pane's linked session (best-effort) first,
  // then stopEnv, then the primary session.
  assert.deepEqual(calls, ["kill", "stopEnv:proj1-ab12cd:feature-x", "kill", "remove"]);
});

test("killProjectSession tolerates stopSessionEnv failing (best-effort teardown)", async () => {
  const removeCalls: string[] = [];
  const deps = makeDeps({
    stopSessionEnv: async () => {
      throw new Error("no environment for this session");
    },
    removeWorktree: async (_repoPath, worktreePath) => {
      removeCalls.push(worktreePath);
    },
  });

  await killProjectSession(PROJECT, "feature-x", deps);

  assert.deepEqual(removeCalls, ["/data/worktrees/proj1-ab12cd/feature-x"]);
});

test("isProjectSessionBranchMerged delegates to deps.isBranchMerged with repoPath and the session slug as branch name", async () => {
  const calls: Array<[string, string]> = [];
  const deps = makeDeps({
    isBranchMerged: async (repoPath, branchName) => {
      calls.push([repoPath, branchName]);
      return false;
    },
  });

  const merged = await isProjectSessionBranchMerged(PROJECT, "feature-x", deps);

  assert.equal(merged, false);
  assert.deepEqual(calls, [["/repo", "feature-x"]]);
});

test("getProjectSessionPasteBuffer validates the session slug before reading the buffer", async () => {
  let called = false;
  const deps = makeDeps({
    readPasteBuffer: async () => {
      called = true;
      return "should not be reached";
    },
  });

  await assert.rejects(() => getProjectSessionPasteBuffer(PROJECT, "!!!", deps), ValidationError);
  assert.equal(called, false);
});

test("getProjectSessionPasteBuffer returns deps.readPasteBuffer's text for a valid session slug", async () => {
  const deps = makeDeps({ readPasteBuffer: async () => "copied text\nsecond line\n" });

  const text = await getProjectSessionPasteBuffer(PROJECT, "feature-x", deps);

  assert.equal(text, "copied text\nsecond line\n");
});

test("killProjectSessionSplit kills only the split pane's linked session", async () => {
  const calls: string[] = [];
  const deps = makeDeps({
    killSession: async (name) => {
      calls.push(name);
    },
  });

  await killProjectSessionSplit(PROJECT, "feature-x", deps);

  assert.deepEqual(calls, [splitPaneSessionName("proj1-ab12cd__feature-x")]);
});

test("killProjectSessionSplit tolerates the split never having been opened", async () => {
  const deps = makeDeps({
    killSession: async () => {
      throw new Error("can't find session");
    },
  });

  await killProjectSessionSplit(PROJECT, "feature-x", deps);
});

test("getProjectSessionChanges resolves the worktree path and delegates to getChangedFiles", async () => {
  const calls: string[] = [];
  const grouped: GroupedChanges = { staged: [], unstaged: [], untracked: [], conflicted: [], repoState: "clean" };
  const deps = makeDeps({
    getChangedFiles: async (worktreePath: string) => {
      calls.push(worktreePath);
      return grouped;
    },
  });

  const result = await getProjectSessionChanges(PROJECT, "feature-x", deps);

  assert.deepEqual(calls, ["/data/worktrees/proj1-ab12cd/feature-x"]);
  assert.equal(result, grouped);
});

test("getProjectSessionDiff resolves the worktree path and delegates to getFileDiff", async () => {
  const calls: Array<{ worktreePath: string; filePath: string; mode: string }> = [];
  const deps = makeDeps({
    getFileDiff: async (worktreePath: string, filePath: string, mode: "staged" | "unstaged" | "untracked") => {
      calls.push({ worktreePath, filePath, mode });
      return { diff: "diff text", isUntracked: false, isBinary: false };
    },
  });

  const result = await getProjectSessionDiff(PROJECT, "feature-x", "src/index.ts", "staged", deps);

  assert.deepEqual(calls, [
    { worktreePath: "/data/worktrees/proj1-ab12cd/feature-x", filePath: "src/index.ts", mode: "staged" },
  ]);
  assert.equal(result.diff, "diff text");
});

test("stageProjectSessionFile resolves the worktree path and delegates to stageFile", async () => {
  const calls: Array<{ worktreePath: string; filePath: string }> = [];
  const deps = makeDeps({
    stageFile: async (worktreePath: string, filePath: string) => {
      calls.push({ worktreePath, filePath });
    },
  });

  await stageProjectSessionFile(PROJECT, "feature-x", "src/index.ts", deps);

  assert.deepEqual(calls, [
    { worktreePath: "/data/worktrees/proj1-ab12cd/feature-x", filePath: "src/index.ts" },
  ]);
});

test("unstageProjectSessionFile resolves the worktree path and delegates to unstageFile", async () => {
  const calls: Array<{ worktreePath: string; filePath: string }> = [];
  const deps = makeDeps({
    unstageFile: async (worktreePath: string, filePath: string) => {
      calls.push({ worktreePath, filePath });
    },
  });

  await unstageProjectSessionFile(PROJECT, "feature-x", "src/index.ts", deps);

  assert.deepEqual(calls, [
    { worktreePath: "/data/worktrees/proj1-ab12cd/feature-x", filePath: "src/index.ts" },
  ]);
});

test("discardProjectSessionFile resolves the worktree path and delegates to discardFile", async () => {
  const calls: Array<{ worktreePath: string; filePath: string; mode: string }> = [];
  const deps = makeDeps({
    discardFile: async (worktreePath: string, filePath: string, mode: "staged" | "unstaged" | "untracked") => {
      calls.push({ worktreePath, filePath, mode });
    },
  });

  await discardProjectSessionFile(PROJECT, "feature-x", "src/index.ts", "unstaged", deps);

  assert.deepEqual(calls, [
    { worktreePath: "/data/worktrees/proj1-ab12cd/feature-x", filePath: "src/index.ts", mode: "unstaged" },
  ]);
});

test("commitProjectSessionChanges resolves the worktree path and delegates to commitStaged", async () => {
  const calls: Array<{ worktreePath: string; message: string }> = [];
  const deps = makeDeps({
    commitStaged: async (worktreePath: string, message: string) => {
      calls.push({ worktreePath, message });
    },
  });

  await commitProjectSessionChanges(PROJECT, "feature-x", "fix: a bug", deps);

  assert.deepEqual(calls, [
    { worktreePath: "/data/worktrees/proj1-ab12cd/feature-x", message: "fix: a bug" },
  ]);
});

test("startProjectSessionCreation returns {name, fullName} immediately without waiting for the background work", async () => {
  const deps = makeDeps({ addWorktree: () => new Promise(() => {}) }); // never resolves during this test
  const store = createSessionCreationStore();

  const result = await startProjectSessionCreation(PROJECT, "Feature X", deps, store);

  assert.deepEqual(result, { name: "feature-x", fullName: "proj1-ab12cd__feature-x" });
});

test("startProjectSessionCreation leaves the store in phase 'creating' right after it returns", async () => {
  const deps = makeDeps({ addWorktree: () => new Promise(() => {}) }); // never resolves during this test
  const store = createSessionCreationStore();

  await startProjectSessionCreation(PROJECT, "feature-x", deps, store);

  assert.deepEqual(store.get("proj1-ab12cd__feature-x"), { phase: "creating" });
});

test("startProjectSessionCreation rejects a second truly concurrent create for the same name (no TOCTOU race)", async () => {
  let addWorktreeCalls = 0;
  const deps = makeDeps({
    addWorktree: async () => {
      addWorktreeCalls++;
    },
  });
  const store = createSessionCreationStore();

  // Both calls fire before either has a chance to claim the store entry --
  // mirrors "startSessionEnv rejects a second truly concurrent start()..."
  // in session-env.test.ts.
  const results = await Promise.allSettled([
    startProjectSessionCreation(PROJECT, "feature-x", deps, store),
    startProjectSessionCreation(PROJECT, "feature-x", deps, store),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].status === "rejected" && rejected[0].reason instanceof SessionCreationInProgressError);

  await flush();
  assert.equal(addWorktreeCalls, 1);
});

test("startProjectSessionCreation reports {phase: 'ready', session} once the background work completes", async () => {
  const deps = makeDeps();
  const store = createSessionCreationStore();

  await startProjectSessionCreation(PROJECT, "feature-x", deps, store);
  await flush();

  assert.deepEqual(store.get("proj1-ab12cd__feature-x"), {
    phase: "ready",
    session: { name: "feature-x", fullName: "proj1-ab12cd__feature-x", windows: 1, attached: false, favorite: false },
  });
});

test("startProjectSessionCreation reports {phase: 'error', message} when createSession throws", async () => {
  const deps = makeDeps({
    createSession: async () => {
      throw new Error("tmux exploded");
    },
  });
  const store = createSessionCreationStore();

  await startProjectSessionCreation(PROJECT, "feature-x", deps, store);
  await flush();

  const status = store.get("proj1-ab12cd__feature-x");
  assert.equal(status?.phase, "error");
  assert.match(status?.message ?? "", /tmux exploded/);
});

test("startProjectSessionCreation records progress messages from addWorktree and the tmux-start step in order", async () => {
  const deps = makeDeps({
    addWorktree: async (_repoPath, _worktreePath, _branchName, onProgress) => {
      onProgress?.("Creating worktree…");
    },
  });
  const store = createSessionCreationStore();
  const fullName = "proj1-ab12cd__feature-x";
  const messages: Array<string | undefined> = [];
  const originalSet = store.set.bind(store);
  store.set = (key: string, value: SessionCreationStatus) => {
    if (key === fullName) messages.push(value.message);
    return originalSet(key, value);
  };

  await startProjectSessionCreation(PROJECT, "feature-x", deps, store);
  await flush();

  assert.deepEqual(messages, [undefined, "Creating worktree…", "Starting tmux session…", undefined]);
});

test("getSessionCreationStatus throws SessionCreationNotFoundError when nothing is in the store for that slug", async () => {
  const store = createSessionCreationStore();

  await assert.rejects(
    () => getSessionCreationStatus(PROJECT, "feature-x", store),
    SessionCreationNotFoundError,
  );
});

test("getSessionCreationStatus returns whatever is currently in the store for a known slug", async () => {
  const store = createSessionCreationStore();
  store.set("proj1-ab12cd__feature-x", { phase: "creating", message: "Pruning stale worktrees…" });

  const status = await getSessionCreationStatus(PROJECT, "feature-x", store);

  assert.deepEqual(status, { phase: "creating", message: "Pruning stale worktrees…" });
});
