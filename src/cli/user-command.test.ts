import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueAuthToken, resolveAuthToken } from "../auth-tokens.ts";
import { loadUsers, UserValidationError } from "../users.ts";
import { runUserCommand } from "./user-command.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-user-cmd-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runUserCommand add creates a user", async () => {
  await withTempDir(async (dir) => {
    await runUserCommand(["add", "alice", "password123"], dir);
    const users = await loadUsers(join(dir, "users.json"));
    assert.deepEqual(users.map((u) => u.username), ["alice"]);
  });
});

test("runUserCommand add rejects a missing password", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => runUserCommand(["add", "alice"], dir), UserValidationError);
  });
});

test("runUserCommand list reflects added users", async () => {
  await withTempDir(async (dir) => {
    await runUserCommand(["add", "alice", "password123"], dir);
    await runUserCommand(["add", "bob", "password123"], dir);
    await runUserCommand(["list"], dir);
    const users = await loadUsers(join(dir, "users.json"));
    assert.deepEqual(
      users.map((u) => u.username).sort(),
      ["alice", "bob"],
    );
  });
});

test("runUserCommand remove deletes a user", async () => {
  await withTempDir(async (dir) => {
    await runUserCommand(["add", "alice", "password123"], dir);
    await runUserCommand(["remove", "alice"], dir);
    assert.deepEqual(await loadUsers(join(dir, "users.json")), []);
  });
});

test("runUserCommand remove rejects an unknown user", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => runUserCommand(["remove", "nobody"], dir), UserValidationError);
  });
});

test("runUserCommand rejects an unknown subcommand", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => runUserCommand(["frobnicate"], dir), UserValidationError);
  });
});

test("runUserCommand remove also revokes the removed user's tokens", async () => {
  await withTempDir(async (dir) => {
    const authTokensFile = join(dir, "auth-tokens.json");
    const token = await issueAuthToken(authTokensFile, "alice");

    await runUserCommand(["add", "alice", "password123"], dir);
    await runUserCommand(["remove", "alice"], dir);

    assert.equal(await resolveAuthToken(authTokensFile, token), undefined);
  });
});
