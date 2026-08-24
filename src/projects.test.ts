import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadProjects,
  saveProjects,
  generateProjectId,
  listProjects,
  registerProject,
  removeProject,
  getProject,
  ProjectValidationError,
} from "./projects.ts";
import { isGitRepo } from "./worktree.ts";

const execFileAsync = promisify(execFileCb);

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-projects-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadProjects returns an empty array when the file does not exist", async () => {
  await withTempDir(async (dir) => {
    const result = await loadProjects(join(dir, "does-not-exist.json"));
    assert.deepEqual(result, []);
  });
});

test("saveProjects then loadProjects round-trips the data", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    const projects = [
      { id: "p1", userId: "alice", name: "Proj One", repoPath: "/repo1", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    await saveProjects(filePath, projects);
    assert.deepEqual(await loadProjects(filePath), projects);
  });
});

test("saveProjects creates the parent directory if it doesn't exist", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "nested", "deeper", "projects.json");
    await saveProjects(filePath, []);
    assert.deepEqual(await loadProjects(filePath), []);
  });
});

test("generateProjectId combines a slugified name with the injected random suffix", () => {
  assert.equal(generateProjectId("My Project", () => "ab12cd"), "my-project-ab12cd");
});

test("generateProjectId falls back to 'project' when the name has nothing sluggable", () => {
  assert.equal(generateProjectId("!!!", () => "ab12cd"), "project-ab12cd");
});

test("registerProject rejects an empty name", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => registerProject(join(dir, "projects.json"), "alice", "  ", "/abs/repo", { isGitRepo: async () => true }),
      ProjectValidationError,
    );
  });
});

test("registerProject rejects a relative repoPath", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () =>
        registerProject(join(dir, "projects.json"), "alice", "Proj", "relative/path", {
          isGitRepo: async () => true,
        }),
      ProjectValidationError,
    );
  });
});

test("registerProject rejects a path that isn't a git repo", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () =>
        registerProject(join(dir, "projects.json"), "alice", "Proj", "/abs/repo", { isGitRepo: async () => false }),
      ProjectValidationError,
    );
  });
});

test("registerProject appends a new project owned by the given user and persists it", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    const project = await registerProject(filePath, "alice", "My Project", "/abs/repo", {
      isGitRepo: async () => true,
      randomSuffix: () => "ab12cd",
    });

    assert.equal(project.id, "my-project-ab12cd");
    assert.equal(project.userId, "alice");
    assert.equal(project.name, "My Project");
    assert.equal(project.repoPath, "/abs/repo");
    assert.equal(typeof project.createdAt, "string");

    const persisted = await loadProjects(filePath);
    assert.deepEqual(persisted, [project]);
  });
});

test("removeProject removes only the matching project", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    await saveProjects(filePath, [
      { id: "p1", userId: "alice", name: "One", repoPath: "/r1", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "p2", userId: "alice", name: "Two", repoPath: "/r2", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    await removeProject(filePath, "alice", "p1");

    const remaining = await loadProjects(filePath);
    assert.deepEqual(remaining.map((p) => p.id), ["p2"]);
  });
});

test("getProject finds a project by id and returns undefined when missing", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    await saveProjects(filePath, [
      { id: "p1", userId: "alice", name: "One", repoPath: "/r1", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    assert.equal((await getProject(filePath, "alice", "p1"))?.name, "One");
    assert.equal(await getProject(filePath, "alice", "missing"), undefined);
  });
});

test("listProjects returns only the calling user's projects", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    await saveProjects(filePath, [
      { id: "p1", userId: "alice", name: "One", repoPath: "/r1", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "p2", userId: "bob", name: "Two", repoPath: "/r2", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    assert.deepEqual((await listProjects(filePath, "alice")).map((p) => p.id), ["p1"]);
    assert.deepEqual((await listProjects(filePath, "bob")).map((p) => p.id), ["p2"]);
    assert.deepEqual(await listProjects(filePath, "carol"), []);
  });
});

test("getProject returns undefined when the project is owned by a different user", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    await saveProjects(filePath, [
      { id: "p1", userId: "alice", name: "One", repoPath: "/r1", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    assert.equal(await getProject(filePath, "bob", "p1"), undefined);
  });
});

test("removeProject does not remove a project owned by a different user", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    await saveProjects(filePath, [
      { id: "p1", userId: "alice", name: "One", repoPath: "/r1", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    await removeProject(filePath, "bob", "p1");

    const remaining = await loadProjects(filePath);
    assert.deepEqual(remaining.map((p) => p.id), ["p1"]);
  });
});

function isGitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "real git integration: registerProject accepts a real repo and rejects a plain directory",
  { skip: !isGitAvailable() },
  async () => {
    await withTempDir(async (dir) => {
      const repoPath = join(dir, "real-repo");
      const plainDir = join(dir, "plain-dir");
      await execFileAsync("mkdir", ["-p", repoPath, plainDir]);
      await execFileAsync("git", ["init", "--quiet", repoPath]);

      const filePath = join(dir, "projects.json");

      const project = await registerProject(filePath, "alice", "Real Repo", repoPath, { isGitRepo });
      assert.equal(project.repoPath, repoPath);

      await assert.rejects(
        () => registerProject(filePath, "alice", "Plain Dir", plainDir, { isGitRepo }),
        ProjectValidationError,
      );
    });
  },
);

test("registerProject rejects the same user re-registering a repoPath they already have", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    await saveProjects(filePath, [
      { id: "p1", userId: "alice", name: "Alice's copy", repoPath: "/repo/main", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    await assert.rejects(
      () => registerProject(filePath, "alice", "Alice again", "/repo/main", { isGitRepo: async () => true }),
      ProjectValidationError,
    );
  });
});

test("registerProject allows a different user to register a repoPath already registered by someone else", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "projects.json");
    await saveProjects(filePath, [
      { id: "p1", userId: "alice", name: "Alice's copy", repoPath: "/repo/main", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const project = await registerProject(filePath, "bob", "Bob's copy", "/repo/main", { isGitRepo: async () => true });
    assert.equal(project.repoPath, "/repo/main");
    assert.equal(project.userId, "bob");
  });
});
