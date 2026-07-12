import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSessionList,
  isValidSessionName,
  listSessions,
  createSession,
  killSession,
} from "./tmux.ts";

test("parseSessionList returns an empty array for empty output", () => {
  assert.deepEqual(parseSessionList(""), []);
});

test("parseSessionList parses a single detached session", () => {
  assert.deepEqual(parseSessionList("main\t1\t0\n"), [
    { name: "main", windows: 1, attached: false },
  ]);
});

test("parseSessionList parses multiple sessions and marks attached correctly", () => {
  const output = "main\t2\t1\nscratch\t1\t0\n";
  assert.deepEqual(parseSessionList(output), [
    { name: "main", windows: 2, attached: true },
    { name: "scratch", windows: 1, attached: false },
  ]);
});

test("parseSessionList ignores blank trailing lines", () => {
  assert.deepEqual(parseSessionList("main\t1\t0\n\n"), [
    { name: "main", windows: 1, attached: false },
  ]);
});

test("isValidSessionName accepts alphanumeric, dash and underscore names", () => {
  assert.equal(isValidSessionName("main"), true);
  assert.equal(isValidSessionName("dev-1"), true);
  assert.equal(isValidSessionName("work_2"), true);
});

test("isValidSessionName rejects an empty name", () => {
  assert.equal(isValidSessionName(""), false);
});

test("isValidSessionName rejects names with spaces", () => {
  assert.equal(isValidSessionName("my session"), false);
});

test("isValidSessionName rejects shell metacharacters", () => {
  for (const name of ["a;b", "a|b", "a&b", "a$b", "a`b", "a(b)", "a>b"]) {
    assert.equal(isValidSessionName(name), false, `expected "${name}" to be rejected`);
  }
});

test("isValidSessionName rejects colons (tmux target separator)", () => {
  assert.equal(isValidSessionName("main:1"), false);
});

test("isValidSessionName rejects names starting with a dash (flag injection)", () => {
  assert.equal(isValidSessionName("-t"), false);
});

test("isValidSessionName rejects names longer than 64 characters", () => {
  assert.equal(isValidSessionName("a".repeat(65)), false);
  assert.equal(isValidSessionName("a".repeat(64)), true);
});

test("listSessions calls tmux list-sessions with a parseable format and returns parsed sessions", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "main\t1\t1\n" };
  };

  const result = await listSessions(fakeExec);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "tmux");
  assert.deepEqual(calls[0].args, ["list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_attached}"]);
  assert.deepEqual(result, [{ name: "main", windows: 1, attached: true }]);
});

test("listSessions returns an empty array when tmux reports no server running", async () => {
  const fakeExec = async () => {
    const err = new Error("Command failed") as Error & { stderr?: string };
    err.stderr = "no server running on /tmp/tmux-1000/default\n";
    throw err;
  };

  assert.deepEqual(await listSessions(fakeExec), []);
});

test("listSessions rethrows unexpected errors", async () => {
  const fakeExec = async () => {
    throw new Error("tmux binary not found");
  };

  await assert.rejects(() => listSessions(fakeExec), /tmux binary not found/);
});

test("createSession rejects invalid names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => createSession("bad name", fakeExec));
  assert.equal(called, false);
});

test("createSession calls tmux new-session -d -s <name> for a valid name", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "" };
  };

  await createSession("main", fakeExec);

  assert.deepEqual(calls, [{ file: "tmux", args: ["new-session", "-d", "-s", "main"] }]);
});

test("killSession rejects invalid names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => killSession("../etc", fakeExec));
  assert.equal(called, false);
});

test("killSession calls tmux kill-session -t <name> for a valid name", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "" };
  };

  await killSession("main", fakeExec);

  assert.deepEqual(calls, [{ file: "tmux", args: ["kill-session", "-t", "main"] }]);
});
