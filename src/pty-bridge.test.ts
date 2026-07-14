import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as pty from "node-pty";
import {
  parseClientMessage,
  attachPtyToSocket,
  type PtyLike,
  type SocketLike,
} from "./pty-bridge.ts";
import { createSession, killSession } from "./tmux.ts";

test("parseClientMessage parses a valid input message", () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "input", data: "ls\n" })), {
    type: "input",
    data: "ls\n",
  });
});

test("parseClientMessage parses a valid resize message", () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "resize", cols: 100, rows: 40 })), {
    type: "resize",
    cols: 100,
    rows: 40,
  });
});

test("parseClientMessage returns null for malformed JSON", () => {
  assert.equal(parseClientMessage("not json"), null);
});

test("parseClientMessage returns null for an unknown type", () => {
  assert.equal(parseClientMessage(JSON.stringify({ type: "eval", data: "rm -rf /" })), null);
});

test("parseClientMessage returns null when input data is missing", () => {
  assert.equal(parseClientMessage(JSON.stringify({ type: "input" })), null);
});

test("parseClientMessage returns null for non-integer resize dimensions", () => {
  assert.equal(parseClientMessage(JSON.stringify({ type: "resize", cols: 80.5, rows: 24 })), null);
});

test("parseClientMessage returns null for zero or negative resize dimensions", () => {
  assert.equal(parseClientMessage(JSON.stringify({ type: "resize", cols: 0, rows: 24 })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "resize", cols: 80, rows: -1 })), null);
});

test("parseClientMessage parses a valid scroll message", () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "scroll", direction: "up", lines: 3 })), {
    type: "scroll",
    direction: "up",
    lines: 3,
  });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "scroll", direction: "down", lines: 1 })), {
    type: "scroll",
    direction: "down",
    lines: 1,
  });
});

test("parseClientMessage returns null for an invalid scroll direction", () => {
  assert.equal(parseClientMessage(JSON.stringify({ type: "scroll", direction: "sideways", lines: 3 })), null);
});

test("parseClientMessage returns null for non-integer or non-positive scroll lines", () => {
  assert.equal(parseClientMessage(JSON.stringify({ type: "scroll", direction: "up", lines: 0 })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "scroll", direction: "up", lines: -2 })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "scroll", direction: "up", lines: 1.5 })), null);
});

class FakePty implements PtyLike {
  dataCallback: ((data: string) => void) | null = null;
  exitCallback: (() => void) | null = null;
  written: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;

  onData(cb: (data: string) => void): void {
    this.dataCallback = cb;
  }
  onExit(cb: () => void): void {
    this.exitCallback = cb;
  }
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
  }
  emitData(data: string): void {
    this.dataCallback?.(data);
  }
  emitExit(): void {
    this.exitCallback?.();
  }
}

class FakeSocket implements SocketLike {
  readyState = 1;
  OPEN = 1;
  sent: string[] = [];
  closed = false;
  private messageListeners: Array<(data: unknown) => void> = [];
  private closeListeners: Array<() => void> = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  on(event: "message" | "close", listener: (data?: unknown) => void): void {
    if (event === "message") this.messageListeners.push(listener);
    else this.closeListeners.push(listener);
  }
  emitMessage(data: string): void {
    for (const listener of this.messageListeners) listener(data);
  }
  emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }
}

test("attachPtyToSocket spawns the pty with the requested session, cols and rows", () => {
  const fakePty = new FakePty();
  const calls: Array<{ sessionName: string; cols: number; rows: number }> = [];
  const spawnPty = (sessionName: string, cols: number, rows: number) => {
    calls.push({ sessionName, cols, rows });
    return fakePty;
  };

  attachPtyToSocket(new FakeSocket(), "main", 80, 24, spawnPty);

  assert.deepEqual(calls, [{ sessionName: "main", cols: 80, rows: 24 }]);
});

test("attachPtyToSocket forwards pty output to the socket", () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty);
  fakePty.emitData("hello from tmux");

  assert.deepEqual(socket.sent, ["hello from tmux"]);
});

test("attachPtyToSocket does not send to an already-closed socket", () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();
  socket.readyState = 3; // CLOSED

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty);
  fakePty.emitData("late data");

  assert.deepEqual(socket.sent, []);
});

test("attachPtyToSocket writes input messages from the socket to the pty", () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty);
  socket.emitMessage(JSON.stringify({ type: "input", data: "ls\n" }));

  assert.deepEqual(fakePty.written, ["ls\n"]);
});

test("attachPtyToSocket resizes the pty on resize messages", () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty);
  socket.emitMessage(JSON.stringify({ type: "resize", cols: 120, rows: 50 }));

  assert.deepEqual(fakePty.resizes, [{ cols: 120, rows: 50 }]);
});

test("attachPtyToSocket dispatches scroll messages to scrollPaneFn with the session name", async () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();
  const calls: Array<{ sessionName: string; direction: string; lines: number }> = [];
  const scrollPaneFn = async (sessionName: string, direction: "up" | "down", lines: number) => {
    calls.push({ sessionName, direction, lines });
  };

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty, scrollPaneFn);
  socket.emitMessage(JSON.stringify({ type: "scroll", direction: "up", lines: 3 }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [{ sessionName: "main", direction: "up", lines: 3 }]);
});

test("attachPtyToSocket cancels copy-mode before writing input that follows a scroll-up", async () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();
  const order: string[] = [];
  const scrollPaneFn = async () => {
    order.push("scroll-up");
  };
  const cancelCopyModeFn = async (sessionName: string) => {
    order.push(`cancel:${sessionName}`);
  };

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty, scrollPaneFn, cancelCopyModeFn);
  socket.emitMessage(JSON.stringify({ type: "scroll", direction: "up", lines: 3 }));
  socket.emitMessage(JSON.stringify({ type: "input", data: "x" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(order, ["scroll-up", "cancel:main"]);
  assert.deepEqual(fakePty.written, ["x"]);
});

test("attachPtyToSocket gates every keystroke typed during a slow cancel, not just the first", async () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();
  let cancelCalls = 0;
  const scrollPaneFn = async () => {};
  // A cancel that takes a few microtask ticks to resolve -- long enough for
  // several rapid-fire "input" messages (one per keystroke, as a real user
  // typing would send) to arrive before it settles.
  const cancelCopyModeFn = async () => {
    cancelCalls++;
    await Promise.resolve();
    await Promise.resolve();
  };

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty, scrollPaneFn, cancelCopyModeFn);
  socket.emitMessage(JSON.stringify({ type: "scroll", direction: "up", lines: 3 }));
  for (const ch of ["e", "c", "h", "o", "\r"]) {
    socket.emitMessage(JSON.stringify({ type: "input", data: ch }));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(cancelCalls, 1, "cancel should only be requested once, not once per keystroke");
  assert.deepEqual(fakePty.written, ["e", "c", "h", "o", "\r"], "keystrokes must land in order, after the cancel");
});

test("attachPtyToSocket does not call cancelCopyModeFn for input when no scroll-up has happened", () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();
  let cancelCalls = 0;
  const cancelCopyModeFn = async () => {
    cancelCalls++;
  };

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty, undefined, cancelCopyModeFn);
  socket.emitMessage(JSON.stringify({ type: "input", data: "ls\n" }));

  assert.equal(cancelCalls, 0);
  assert.deepEqual(fakePty.written, ["ls\n"]);
});

test("attachPtyToSocket ignores malformed socket messages", () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty);
  socket.emitMessage("not json");

  assert.deepEqual(fakePty.written, []);
  assert.deepEqual(fakePty.resizes, []);
});

test("attachPtyToSocket kills the pty when the socket closes (detach, not session-kill)", () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty);
  socket.emitClose();

  assert.equal(fakePty.killed, true);
});

test("attachPtyToSocket closes the socket when the pty exits", () => {
  const fakePty = new FakePty();
  const socket = new FakeSocket();

  attachPtyToSocket(socket, "main", 80, 24, () => fakePty);
  fakePty.emitExit();

  assert.equal(socket.closed, true);
});

function isTmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(
  "real tmux integration: attaching a real pty shows session output",
  { skip: !isTmuxAvailable() },
  async () => {
    const sessionName = `pty-bridge-test-${process.pid}`;
    await createSession(sessionName);
    let term: pty.IPty | undefined;
    try {
      term = pty.spawn("tmux", ["attach-session", "-t", sessionName], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.env.HOME ?? process.cwd(),
        env: process.env as Record<string, string>,
      });

      let output = "";
      term.onData((data) => {
        output += data;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      execFileSync("tmux", ["send-keys", "-t", sessionName, "echo PTY_BRIDGE_TEST_MARKER", "Enter"]);
      await new Promise((resolve) => setTimeout(resolve, 500));

      assert.match(output, /PTY_BRIDGE_TEST_MARKER/);
    } finally {
      term?.kill();
      await killSession(sessionName).catch(() => {});
    }
  },
);

function tmuxDisplayMessage(sessionName: string, format: string): string {
  return execFileSync("tmux", ["display-message", "-p", "-t", sessionName, format]).toString().trim();
}

async function waitForPaneText(
  sessionName: string,
  pattern: string,
  { timeoutMs = 3000, intervalMs = 50 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const captured = execFileSync("tmux", ["capture-pane", "-p", "-t", sessionName]).toString();
    if (captured.includes(pattern)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for pane to show ${JSON.stringify(pattern)}`);
}

test(
  "real tmux integration: a scroll message drives tmux copy-mode and changes the visible pane, input resumes it",
  { skip: !isTmuxAvailable() },
  async () => {
    const sessionName = `pty-bridge-scroll-test-${process.pid}`;
    await createSession(sessionName);
    let term: PtyLike | undefined;
    try {
      // Plain `tmux capture-pane -p` always reads the pane's canonical (live)
      // grid -- it does NOT reflect a client's copy-mode scroll offset, only
      // `#{scroll_position}` (and capture-pane's own `-S`/`-E` history range
      // flags) do. Confirmed empirically: capture-pane -p is unchanged by
      // copy-mode scrolling even while `#{pane_in_mode}` is 1 and
      // `#{scroll_position}` is nonzero. So this test asserts on those
      // instead of diffing capture-pane output.
      execFileSync("tmux", [
        "send-keys",
        "-t",
        sessionName,
        "for i in $(seq 1 300); do echo LINE_$i; done; echo FILL_DONE_MARKER",
        "Enter",
      ]);
      await waitForPaneText(sessionName, "FILL_DONE_MARKER");

      assert.equal(tmuxDisplayMessage(sessionName, "#{pane_in_mode}"), "0", "sanity: not in copy-mode yet");

      // waitForPaneText just ran several rapid-fire `tmux capture-pane`
      // invocations from outside any tmux client -- empirically, tmux needs
      // a brief moment for that ephemeral-client churn to settle before a
      // *new* client's copy-mode/send-keys reliably resolves to it (without
      // this, `copy-mode`/`send-keys -X scroll-up` below can silently
      // resolve against the wrong (stale) client and leave
      // `#{scroll_position}` at 0 despite exiting cleanly). Confirmed by
      // bisecting: removing this delay makes the assertions below fail
      // consistently; production code never polls the target pane's
      // capture-pane in a tight loop right before attaching, so this is a
      // test-harness artifact, not a real product-facing race.
      await new Promise((resolve) => setTimeout(resolve, 250));

      const socket = new FakeSocket();
      term = attachPtyToSocket(socket, sessionName, 80, 24);

      socket.emitMessage(JSON.stringify({ type: "scroll", direction: "up", lines: 100 }));
      await new Promise((resolve) => setTimeout(resolve, 600));

      assert.equal(
        tmuxDisplayMessage(sessionName, "#{pane_in_mode}"),
        "1",
        "pane should be in copy-mode after scrolling up",
      );
      const scrollPosition = Number(tmuxDisplayMessage(sessionName, "#{scroll_position}"));
      assert.ok(scrollPosition > 0, `expected a positive scroll offset, got ${scrollPosition}`);

      // The scrolled-to view (independent of any client's current position)
      // should show lines from well before the live tail.
      const scrolledHistory = execFileSync("tmux", [
        "capture-pane",
        "-p",
        "-t",
        sessionName,
        "-S",
        String(-scrollPosition),
        "-E",
        String(-scrollPosition + 5),
      ]).toString();
      assert.match(scrolledHistory, /LINE_\d+/);

      // One WS "input" message per keystroke, matching how a real user
      // typing sends data (public/app.js's term.onData fires per key) --
      // this is what actually exposed the "only the first keystroke waits
      // for cancel" bug that a single combined message would have hidden.
      for (const ch of "echo RESUMED_AFTER_SCROLL\n") {
        socket.emitMessage(JSON.stringify({ type: "input", data: ch }));
      }
      await waitForPaneText(sessionName, "RESUMED_AFTER_SCROLL");

      assert.equal(
        tmuxDisplayMessage(sessionName, "#{pane_in_mode}"),
        "0",
        "typing again should cancel copy-mode",
      );
    } finally {
      term?.kill();
      await killSession(sessionName).catch(() => {});
    }
  },
);
