import { test } from "node:test";
import assert from "node:assert/strict";
import { createPendingTaskStore, resolveHookEvent, getSessionStatus } from "./pending-tasks.ts";
import { sendMessage, type SendMessageDeps, type SendMessageOptions } from "./send-message.ts";

function baseOptions(overrides: Partial<SendMessageOptions> = {}): SendMessageOptions {
  return {
    fullSessionName: "proj__feature",
    worktreePath: "/worktrees/proj/feature",
    hookCommand: "node hook-script.ts --session proj__feature --listener http://127.0.0.1:5310 --secret s3cr3t",
    message: "add a test for foo",
    waitTimeoutMs: 5_000,
    ...overrides,
  };
}

// capturePane returns the same non-empty string on every call, so
// waitForReplReady's "stable across two consecutive polls" check is
// satisfied on its very first comparison -- deterministic and fast in
// tests, no need to model a real slow-starting REPL here.
function baseDeps(overrides: Partial<SendMessageDeps> = {}): SendMessageDeps {
  return {
    hasSession: async () => true,
    createSession: async () => {},
    destroySession: async () => {},
    sendKeys: async () => {},
    ensureHooks: async () => {},
    capturePane: async () => "ready-banner",
    sleep: async () => {},
    ...overrides,
  };
}

test("sendMessage on a brand-new session creates it, installs hooks, launches claude, waits for it to be ready, then types the message", async () => {
  const store = createPendingTaskStore();
  const calls: string[] = [];
  const deps = baseDeps({
    hasSession: async () => false,
    createSession: async (fullName, worktreePath) => {
      calls.push(`create:${fullName}:${worktreePath}`);
    },
    ensureHooks: async (worktreePath, hookCommand) => {
      calls.push(`hooks:${worktreePath}:${hookCommand}`);
    },
    sendKeys: async (fullName, text) => {
      calls.push(`sendKeys:${fullName}:${text}`);
    },
    capturePane: async () => {
      calls.push("capturePane");
      return "ready-banner";
    },
  });

  const options = baseOptions();
  const pending = sendMessage(options, store, deps);
  // beginWait registers its resolver synchronously as the very first thing
  // sendMessage does -- resolving right away (no artificial delay) proves
  // that registration isn't racing the create/hooks/launch setup below.
  resolveHookEvent(store, options.fullSessionName, { hookEvent: "Stop", text: "all done" });

  const result = await pending;

  assert.deepEqual(result, { status: "result", text: "all done" });
  assert.deepEqual(calls, [
    "create:proj__feature:/worktrees/proj/feature",
    "hooks:/worktrees/proj/feature:node hook-script.ts --session proj__feature --listener http://127.0.0.1:5310 --secret s3cr3t",
    "sendKeys:proj__feature:claude",
    "capturePane",
    "capturePane",
    "sendKeys:proj__feature:add a test for foo",
  ]);
});

test("sendMessage on an existing session does not recreate it or reinstall hooks, just types the message", async () => {
  const store = createPendingTaskStore();
  const calls: string[] = [];
  const deps = baseDeps({
    hasSession: async () => true,
    createSession: async () => {
      calls.push("create");
    },
    ensureHooks: async () => {
      calls.push("hooks");
    },
    sendKeys: async (_fullName, text) => {
      calls.push(`sendKeys:${text}`);
    },
  });

  const options = baseOptions();
  const pending = sendMessage(options, store, deps);
  resolveHookEvent(store, options.fullSessionName, { hookEvent: "Notification", text: "need permission?" });
  const result = await pending;

  assert.deepEqual(result, { status: "question", text: "need permission?" });
  assert.deepEqual(calls, ["sendKeys:add a test for foo"]);
});

test("sendMessage returns status busy without touching tmux when the session is already busy", async () => {
  const store = createPendingTaskStore();
  const options = baseOptions();
  const deps = baseDeps();
  // Occupy the session first via a real in-flight call, exactly as a
  // concurrent second caller would encounter it.
  const first = sendMessage(options, store, deps);

  let touched = false;
  const secondDeps = baseDeps({
    sendKeys: async () => {
      touched = true;
    },
  });
  const result = await sendMessage(options, store, secondDeps);

  assert.deepEqual(result, { status: "busy" });
  assert.equal(touched, false);

  resolveHookEvent(store, options.fullSessionName, { hookEvent: "Stop", text: "done" });
  await first;
});

test("sendMessage returns status timeout and frees the session when no hook event arrives in time", async () => {
  const store = createPendingTaskStore();
  const options = baseOptions({ waitTimeoutMs: 10 });
  const deps = baseDeps();

  const result = await sendMessage(options, store, deps);

  assert.deepEqual(result, { status: "timeout" });
  assert.equal(getSessionStatus(store, options.fullSessionName), "idle");
});

test("sendMessage frees the session back to idle if sendKeys(message) throws on an existing session", async () => {
  const store = createPendingTaskStore();
  const options = baseOptions();
  const deps = baseDeps({
    sendKeys: async () => {
      throw new Error("tmux send-keys failed");
    },
  });

  await assert.rejects(sendMessage(options, store, deps), /tmux send-keys failed/);
  assert.equal(getSessionStatus(store, options.fullSessionName), "idle");
});

test("sendMessage rolls back (destroySession) a newly-created session if ensureHooks fails, and frees the session", async () => {
  const store = createPendingTaskStore();
  const options = baseOptions();
  const destroyed: Array<[string, string]> = [];
  const deps = baseDeps({
    hasSession: async () => false,
    ensureHooks: async () => {
      throw new Error("disk error writing settings.local.json");
    },
    destroySession: async (fullName, worktreePath) => {
      destroyed.push([fullName, worktreePath]);
    },
  });

  await assert.rejects(sendMessage(options, store, deps), /disk error/);

  assert.deepEqual(destroyed, [[options.fullSessionName, options.worktreePath]]);
  assert.equal(getSessionStatus(store, options.fullSessionName), "idle");
});

test("sendMessage rolls back (destroySession) a newly-created session if launching claude fails", async () => {
  const store = createPendingTaskStore();
  const options = baseOptions();
  const destroyed: string[] = [];
  const deps = baseDeps({
    hasSession: async () => false,
    sendKeys: async (_fullName, text) => {
      if (text === "claude") throw new Error("tmux send-keys failed");
    },
    destroySession: async (fullName) => {
      destroyed.push(fullName);
    },
  });

  await assert.rejects(sendMessage(options, store, deps), /tmux send-keys failed/);
  assert.deepEqual(destroyed, [options.fullSessionName]);
});

test("sendMessage does not roll back an existing session (only ever destroys sessions it just created)", async () => {
  const store = createPendingTaskStore();
  const options = baseOptions();
  let destroyCalled = false;
  const deps = baseDeps({
    hasSession: async () => true,
    sendKeys: async () => {
      throw new Error("boom");
    },
    destroySession: async () => {
      destroyCalled = true;
    },
  });

  await assert.rejects(sendMessage(options, store, deps), /boom/);
  assert.equal(destroyCalled, false);
});

test("sendMessage allows a second call for the same session once the first has resolved", async () => {
  const store = createPendingTaskStore();
  const options = baseOptions();
  const deps = baseDeps();

  const first = sendMessage(options, store, deps);
  resolveHookEvent(store, options.fullSessionName, { hookEvent: "Stop", text: "first done" });
  await first;

  const second = sendMessage(options, store, deps);
  resolveHookEvent(store, options.fullSessionName, { hookEvent: "Stop", text: "second done" });
  const result = await second;

  assert.deepEqual(result, { status: "result", text: "second done" });
});
