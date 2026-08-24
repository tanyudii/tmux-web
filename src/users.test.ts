import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadUsers,
  saveUsers,
  createUser,
  removeUser,
  verifyPassword,
  verifyPasswordHash,
  hashPassword,
  UserValidationError,
} from "./users.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-users-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadUsers returns an empty array when the file does not exist", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await loadUsers(join(dir, "missing.json")), []);
  });
});

test("saveUsers then loadUsers round-trips the data", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "users.json");
    const users = [{ username: "alice", passwordHash: "salt:hash", createdAt: "2026-01-01T00:00:00.000Z" }];
    await saveUsers(filePath, users);
    assert.deepEqual(await loadUsers(filePath), users);
  });
});

test("hashPassword + verifyPasswordHash round-trips a correct password and rejects a wrong one", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.equal(verifyPasswordHash("correct horse battery staple", hash), true);
  assert.equal(verifyPasswordHash("wrong password", hash), false);
});

test("createUser rejects an empty username", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => createUser(join(dir, "users.json"), "  ", "password123"),
      UserValidationError,
    );
  });
});

test("createUser rejects a too-short password", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => createUser(join(dir, "users.json"), "alice", "short"),
      UserValidationError,
    );
  });
});

test("createUser rejects a duplicate username", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "users.json");
    await createUser(filePath, "alice", "password123");
    await assert.rejects(() => createUser(filePath, "alice", "password456"), UserValidationError);
  });
});

test("createUser persists a user with a hashed password", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "users.json");
    const user = await createUser(filePath, "alice", "password123");

    assert.equal(user.username, "alice");
    assert.notEqual(user.passwordHash, "password123");

    const persisted = await loadUsers(filePath);
    assert.deepEqual(persisted, [user]);
  });
});

test("removeUser removes only the matching user", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "users.json");
    await createUser(filePath, "alice", "password123");
    await createUser(filePath, "bob", "password123");

    await removeUser(filePath, "alice");

    const remaining = await loadUsers(filePath);
    assert.deepEqual(remaining.map((user) => user.username), ["bob"]);
  });
});

test("verifyPassword returns true only for the correct username/password pair", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "users.json");
    await createUser(filePath, "alice", "password123");

    assert.equal(await verifyPassword(filePath, "alice", "password123"), true);
    assert.equal(await verifyPassword(filePath, "alice", "wrong-password"), false);
    assert.equal(await verifyPassword(filePath, "nonexistent", "password123"), false);
  });
});
