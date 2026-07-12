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
