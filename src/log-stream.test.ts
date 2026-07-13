import { test } from "node:test";
import assert from "node:assert/strict";
import { attachLogsToSocket, type LogProcessLike, type LogSocketLike } from "./log-stream.ts";
import type { ComposeContext } from "./docker-compose.ts";

const ctx: ComposeContext = {
  projectName: "proj1__feature-x",
  composeFile: "/repo/worktree/.tmux-web-env/docker-compose.yml",
  worktreePath: "/repo/worktree",
};

class FakeLogProcess implements LogProcessLike {
  dataCallback: ((data: string) => void) | null = null;
  exitCallback: (() => void) | null = null;
  killed = false;

  onData(cb: (data: string) => void): void {
    this.dataCallback = cb;
  }
  onExit(cb: () => void): void {
    this.exitCallback = cb;
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

class FakeSocket implements LogSocketLike {
  readyState = 1;
  OPEN = 1;
  sent: string[] = [];
  closed = false;
  private closeListeners: Array<() => void> = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  on(event: "close", listener: () => void): void {
    if (event === "close") this.closeListeners.push(listener);
  }
  emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }
}

test("attachLogsToSocket spawns docker compose logs scoped to the session and service filter", () => {
  const fakeProcess = new FakeLogProcess();
  const calls: Array<{ ctx: ComposeContext; service: string | undefined }> = [];
  const spawnLogs = (c: ComposeContext, service: string | undefined) => {
    calls.push({ ctx: c, service });
    return fakeProcess;
  };

  attachLogsToSocket(new FakeSocket(), ctx, "web", spawnLogs);

  assert.deepEqual(calls, [{ ctx, service: "web" }]);
});

test("attachLogsToSocket forwards process output to the socket", () => {
  const fakeProcess = new FakeLogProcess();
  const socket = new FakeSocket();

  attachLogsToSocket(socket, ctx, undefined, () => fakeProcess);
  fakeProcess.emitData("web_1  | starting server\n");

  assert.deepEqual(socket.sent, ["web_1  | starting server\n"]);
});

test("attachLogsToSocket does not send to an already-closed socket", () => {
  const fakeProcess = new FakeLogProcess();
  const socket = new FakeSocket();
  socket.readyState = 3; // CLOSED

  attachLogsToSocket(socket, ctx, undefined, () => fakeProcess);
  fakeProcess.emitData("late data");

  assert.deepEqual(socket.sent, []);
});

test("attachLogsToSocket kills the process when the socket closes", () => {
  const fakeProcess = new FakeLogProcess();
  const socket = new FakeSocket();

  attachLogsToSocket(socket, ctx, undefined, () => fakeProcess);
  socket.emitClose();

  assert.equal(fakeProcess.killed, true);
});

test("attachLogsToSocket closes the socket when the process exits (e.g. containers torn down)", () => {
  const fakeProcess = new FakeLogProcess();
  const socket = new FakeSocket();

  attachLogsToSocket(socket, ctx, undefined, () => fakeProcess);
  fakeProcess.emitExit();

  assert.equal(socket.closed, true);
});
