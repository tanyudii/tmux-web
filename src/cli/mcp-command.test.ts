import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveProject,
  resolveSessionSlug,
  buildHookCommand,
  parseMcpArgs,
  McpCommandError,
} from "./mcp-command.ts";
import type { Project } from "../projects.ts";

const PROJECTS: Project[] = [
  { id: "widgets-ab12cd", userId: "alice", name: "widgets", repoPath: "/repos/widgets", createdAt: "2026-01-01T00:00:00.000Z" },
];

test("resolveProject matches by id", () => {
  assert.equal(resolveProject(PROJECTS, "widgets-ab12cd"), PROJECTS[0]);
});

test("resolveProject matches by name", () => {
  assert.equal(resolveProject(PROJECTS, "widgets"), PROJECTS[0]);
});

test("resolveProject throws McpCommandError for an unknown identifier", () => {
  assert.throws(() => resolveProject(PROJECTS, "nope"), McpCommandError);
});

test("resolveSessionSlug slugifies the given session name", () => {
  assert.equal(resolveSessionSlug("Add Login Form"), "add-login-form");
});

test("resolveSessionSlug throws McpCommandError when the name has no usable characters", () => {
  assert.throws(() => resolveSessionSlug("!!!"), McpCommandError);
});

test("buildHookCommand embeds the node path, script path, session name, listener port, and config dir -- never a secret", () => {
  const command = buildHookCommand(
    "/usr/bin/node",
    "/app/src/mcp/hook-script.ts",
    "widgets-ab12cd__feature-x",
    5310,
    "/home/user/.tmux-web",
  );
  assert.equal(
    command,
    "/usr/bin/node --experimental-strip-types /app/src/mcp/hook-script.ts --session widgets-ab12cd__feature-x --listener http://127.0.0.1:5310 --config-dir /home/user/.tmux-web",
  );
});

test("buildHookCommand rejects an invalid session name rather than building an unsafe command string", () => {
  assert.throws(() =>
    buildHookCommand("/usr/bin/node", "/app/hook-script.ts", "bad name; rm -rf", 5310, "/home/user/.tmux-web"),
  );
});

test("parseMcpArgs defaults to stdio mode (http: false) with no args", () => {
  assert.deepEqual(parseMcpArgs([]), { http: false, host: "127.0.0.1", port: 5311 });
});

test("parseMcpArgs recognizes --http and defaults host/port when only --http is given", () => {
  assert.deepEqual(parseMcpArgs(["--http"]), { http: true, host: "127.0.0.1", port: 5311 });
});

test("parseMcpArgs reads --host and --port", () => {
  assert.deepEqual(parseMcpArgs(["--http", "--host", "10.8.0.2", "--port", "6000"]), {
    http: true,
    host: "10.8.0.2",
    port: 6000,
  });
});

test("parseMcpArgs throws McpCommandError for a non-numeric --port", () => {
  assert.throws(() => parseMcpArgs(["--port", "not-a-number"]), McpCommandError);
});

test("parseMcpArgs throws McpCommandError when --host or --port is given with no value", () => {
  assert.throws(() => parseMcpArgs(["--host"]), McpCommandError);
  assert.throws(() => parseMcpArgs(["--port"]), McpCommandError);
});
