import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSessionList,
  parseWindowList,
  isValidSessionName,
  listSessions,
  listWindows,
  createSession,
  killSession,
  getPaneMode,
  capturePane,
  scrollPane,
  cancelCopyMode,
  readPasteBuffer,
  setBellHook,
  ensureLinkedSession,
  sendKeysToSession,
  ValidationError,
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

test("parseWindowList returns an empty array for empty output", () => {
  assert.deepEqual(parseWindowList(""), []);
});

test("parseWindowList parses multiple windows in index order", () => {
  const output = "0\tbash\n1\tserver\n";
  assert.deepEqual(parseWindowList(output), [
    { index: 0, name: "bash" },
    { index: 1, name: "server" },
  ]);
});

test("parseWindowList ignores blank trailing lines", () => {
  assert.deepEqual(parseWindowList("0\tbash\n\n"), [{ index: 0, name: "bash" }]);
});

test("listWindows rejects invalid session names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => listWindows("-t", fakeExec), ValidationError);
  assert.equal(called, false);
});

test("listWindows calls tmux list-windows -t <name> with a parseable format and returns parsed windows", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "0\tbash\n1\tserver\n" };
  };

  const result = await listWindows("main", fakeExec);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "tmux");
  assert.deepEqual(calls[0].args, ["list-windows", "-t", "main", "-F", "#{window_index}\t#{window_name}"]);
  assert.deepEqual(result, [
    { index: 0, name: "bash" },
    { index: 1, name: "server" },
  ]);
});

test("createSession rejects invalid names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => createSession("bad name", {}, fakeExec), ValidationError);
  assert.equal(called, false);
});

test("createSession calls tmux new-session -d -s <name> for a valid name", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "" };
  };

  await createSession("main", {}, fakeExec);

  assert.deepEqual(calls, [{ file: "tmux", args: ["new-session", "-d", "-s", "main"] }]);
});

test("createSession passes -c <cwd> when a working directory is given", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "" };
  };

  await createSession("main", { cwd: "/home/user/worktrees/main" }, fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["new-session", "-d", "-s", "main", "-c", "/home/user/worktrees/main"] },
  ]);
});

test("killSession rejects invalid names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => killSession("../etc", fakeExec), ValidationError);
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

function fakeExecWithPaneMode(inMode: boolean, calls: Array<{ file: string; args: string[] }>) {
  return async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (args[0] === "display-message") return { stdout: inMode ? "1\n" : "0\n" };
    return { stdout: "" };
  };
}

test("getPaneMode rejects invalid session names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "0\n" };
  };

  await assert.rejects(() => getPaneMode("bad name", fakeExec), ValidationError);
  assert.equal(called, false);
});

test("getPaneMode queries #{pane_in_mode} and returns true when tmux reports 1", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = fakeExecWithPaneMode(true, calls);

  assert.equal(await getPaneMode("main", fakeExec), true);
  assert.deepEqual(calls, [
    { file: "tmux", args: ["display-message", "-p", "-t", "main", "#{pane_in_mode}"] },
  ]);
});

test("getPaneMode returns false when tmux reports 0", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = fakeExecWithPaneMode(false, calls);

  assert.equal(await getPaneMode("main", fakeExec), false);
});

test("capturePane rejects invalid session names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => capturePane("bad name", fakeExec), ValidationError);
  assert.equal(called, false);
});

test("capturePane returns tmux's captured pane text verbatim", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "line one\nline two\n" };
  };

  assert.equal(await capturePane("main", fakeExec), "line one\nline two\n");
  assert.deepEqual(calls, [{ file: "tmux", args: ["capture-pane", "-p", "-t", "main"] }]);
});

test("readPasteBuffer returns tmux's paste buffer text verbatim", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "selected line one\nselected line two\n" };
  };

  assert.equal(await readPasteBuffer(fakeExec), "selected line one\nselected line two\n");
  assert.deepEqual(calls, [{ file: "tmux", args: ["save-buffer", "-"] }]);
});

test("readPasteBuffer propagates the error when tmux has no buffer to read", async () => {
  const fakeExec = async () => {
    throw new Error("no buffer");
  };

  await assert.rejects(() => readPasteBuffer(fakeExec), /no buffer/);
});

test("scrollPane rejects invalid session names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "0\n" };
  };

  await assert.rejects(() => scrollPane("bad name", "up", 3, fakeExec), ValidationError);
  assert.equal(called, false);
});

test("scrollPane('up') enters copy-mode then scrolls up when pane is not already in a mode", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = fakeExecWithPaneMode(false, calls);

  await scrollPane("main", "up", 3, fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["display-message", "-p", "-t", "main", "#{pane_in_mode}"] },
    { file: "tmux", args: ["copy-mode", "-t", "main"] },
    { file: "tmux", args: ["send-keys", "-X", "-t", "main", "-N", "3", "scroll-up"] },
  ]);
});

test("scrollPane('up') skips re-entering copy-mode when already in a mode", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = fakeExecWithPaneMode(true, calls);

  await scrollPane("main", "up", 5, fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["display-message", "-p", "-t", "main", "#{pane_in_mode}"] },
    { file: "tmux", args: ["send-keys", "-X", "-t", "main", "-N", "5", "scroll-up"] },
  ]);
});

test("scrollPane('down') scrolls down when already in copy-mode", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = fakeExecWithPaneMode(true, calls);

  await scrollPane("main", "down", 2, fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["display-message", "-p", "-t", "main", "#{pane_in_mode}"] },
    { file: "tmux", args: ["send-keys", "-X", "-t", "main", "-N", "2", "scroll-down"] },
  ]);
});

test("scrollPane('down') is a no-op when the pane is not in copy-mode", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = fakeExecWithPaneMode(false, calls);

  await scrollPane("main", "down", 2, fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["display-message", "-p", "-t", "main", "#{pane_in_mode}"] },
  ]);
});

test("cancelCopyMode rejects invalid session names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "0\n" };
  };

  await assert.rejects(() => cancelCopyMode("bad name", fakeExec), ValidationError);
  assert.equal(called, false);
});

test("cancelCopyMode sends cancel when the pane is in copy-mode", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = fakeExecWithPaneMode(true, calls);

  await cancelCopyMode("main", fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["display-message", "-p", "-t", "main", "#{pane_in_mode}"] },
    { file: "tmux", args: ["send-keys", "-X", "-t", "main", "cancel"] },
  ]);
});

test("cancelCopyMode is a no-op when the pane is not in copy-mode", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = fakeExecWithPaneMode(false, calls);

  await cancelCopyMode("main", fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["display-message", "-p", "-t", "main", "#{pane_in_mode}"] },
  ]);
});

test("setBellHook rejects invalid session names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => setBellHook("../etc", 5309, fakeExec), ValidationError);
  assert.equal(called, false);
});

test("setBellHook sets the alert-bell hook (not 'bell' -- that hook name doesn't exist in tmux) to curl the internal endpoint", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "" };
  };

  await setBellHook("proj1-ab12cd__feature-x", 5309, fakeExec);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "tmux");
  assert.deepEqual(calls[0].args.slice(0, 3), ["set-hook", "-t", "proj1-ab12cd__feature-x"]);
  assert.equal(calls[0].args[3], "alert-bell");
  const runShellCommand = calls[0].args[4];
  assert.match(runShellCommand, /^run-shell -b '/);
  assert.match(runShellCommand, /curl -fsS -m 3 -X POST "http:\/\/127\.0\.0\.1:5309\/internal\/bell\?session=proj1-ab12cd__feature-x"/);
});

test("sendKeysToSession rejects invalid session names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => sendKeysToSession("../etc", "npm run dev", fakeExec), ValidationError);
  assert.equal(called, false);
});

test("sendKeysToSession sends the text followed by Enter as a single argv element (no shell)", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "" };
  };

  await sendKeysToSession("main", "npm run dev && echo done", fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["send-keys", "-t", "main", "npm run dev && echo done", "Enter"] },
  ]);
});

test("ensureLinkedSession rejects invalid names without calling exec", async () => {
  let called = false;
  const fakeExec = async () => {
    called = true;
    return { stdout: "" };
  };

  await assert.rejects(() => ensureLinkedSession("../etc", "main", fakeExec), ValidationError);
  await assert.rejects(() => ensureLinkedSession("split1", "../etc", fakeExec), ValidationError);
  assert.equal(called, false);
});

test("ensureLinkedSession does nothing when the session already exists", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    return { stdout: "" };
  };

  await ensureLinkedSession("split1", "main", fakeExec);

  assert.deepEqual(calls, [{ file: "tmux", args: ["has-session", "-t", "split1"] }]);
});

test("ensureLinkedSession creates a linked session onto the source when it doesn't exist yet", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fakeExec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (args[0] === "has-session") throw new Error("can't find session split1");
    return { stdout: "" };
  };

  await ensureLinkedSession("split1", "main", fakeExec);

  assert.deepEqual(calls, [
    { file: "tmux", args: ["has-session", "-t", "split1"] },
    { file: "tmux", args: ["new-session", "-d", "-t", "main", "-s", "split1"] },
  ]);
});
