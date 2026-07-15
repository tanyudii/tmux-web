import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWebBuildDir } from "./web-build.ts";

test("resolveWebBuildDir returns the dir when it contains index.html", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-build-"));
  await writeFile(join(dir, "index.html"), "<html></html>");
  try {
    assert.equal(resolveWebBuildDir(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveWebBuildDir returns undefined for a dir without index.html (build not run yet)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-build-"));
  try {
    assert.equal(resolveWebBuildDir(dir), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveWebBuildDir returns undefined for a nonexistent directory", () => {
  assert.equal(resolveWebBuildDir("/nonexistent/path/for/tmux-web-build-test"), undefined);
});
