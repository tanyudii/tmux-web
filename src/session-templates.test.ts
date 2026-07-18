import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadTemplates,
  saveTemplates,
  listProjectTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  TemplateValidationError,
  TemplateNotFoundError,
  type SessionTemplate,
} from "./session-templates.ts";

async function withTempFile(fn: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-templates-"));
  try {
    await fn(join(dir, "session-templates.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadTemplates returns an empty array when the file doesn't exist yet", async () => {
  await withTempFile(async (filePath) => {
    assert.deepEqual(await loadTemplates(filePath), []);
  });
});

test("loadTemplates returns an empty array for a malformed (non-array) file", async () => {
  await withTempFile(async (filePath) => {
    await saveTemplates(filePath, []);
    // saveTemplates always writes an array; simulate corruption by writing
    // a non-array JSON value directly via the fs module it already imports.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, JSON.stringify({ not: "an array" }));
    assert.deepEqual(await loadTemplates(filePath), []);
  });
});

test("saveTemplates writes the templates and loadTemplates reads them back", async () => {
  await withTempFile(async (filePath) => {
    const templates: SessionTemplate[] = [
      { id: "t1", projectId: "p1", name: "Dev server", startupCommand: "npm run dev", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    await saveTemplates(filePath, templates);
    assert.deepEqual(await loadTemplates(filePath), templates);
  });
});

test("saveTemplates leaves no leftover temp file after a successful write", async () => {
  await withTempFile(async (filePath) => {
    await saveTemplates(filePath, []);
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(filePath, ".."));
    assert.deepEqual(entries, ["session-templates.json"]);
  });
});

test("listProjectTemplates filters templates by projectId", async () => {
  await withTempFile(async (filePath) => {
    await saveTemplates(filePath, [
      { id: "t1", projectId: "p1", name: "A", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "t2", projectId: "p2", name: "B", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const result = await listProjectTemplates(filePath, "p1");
    assert.deepEqual(result.map((t) => t.id), ["t1"]);
  });
});

test("createTemplate rejects an empty/whitespace-only name without writing", async () => {
  await withTempFile(async (filePath) => {
    await assert.rejects(() => createTemplate(filePath, "p1", "   ", undefined), TemplateValidationError);
    assert.deepEqual(await loadTemplates(filePath), []);
  });
});

test("createTemplate creates a template with a generated id and normalized startupCommand", async () => {
  await withTempFile(async (filePath) => {
    const template = await createTemplate(filePath, "p1", "Dev server", "  npm run dev  ", () => "fixed-id");
    assert.equal(template.id, "fixed-id");
    assert.equal(template.projectId, "p1");
    assert.equal(template.name, "Dev server");
    assert.equal(template.startupCommand, "npm run dev");
    assert.deepEqual(await listProjectTemplates(filePath, "p1"), [template]);
  });
});

test("createTemplate normalizes an empty/whitespace-only startupCommand to undefined", async () => {
  await withTempFile(async (filePath) => {
    const template = await createTemplate(filePath, "p1", "No-op template", "   ", () => "fixed-id");
    assert.equal(template.startupCommand, undefined);
  });
});

test("updateTemplate rejects an empty name without writing", async () => {
  await withTempFile(async (filePath) => {
    const created = await createTemplate(filePath, "p1", "Original", undefined, () => "t1");
    await assert.rejects(() => updateTemplate(filePath, "p1", created.id, "", undefined), TemplateValidationError);
    const stored = await listProjectTemplates(filePath, "p1");
    assert.deepEqual(stored.map((t) => ({ id: t.id, name: t.name })), [{ id: created.id, name: created.name }]);
  });
});

test("updateTemplate throws TemplateNotFoundError for an unknown id", async () => {
  await withTempFile(async (filePath) => {
    await assert.rejects(() => updateTemplate(filePath, "p1", "missing", "New name", undefined), TemplateNotFoundError);
  });
});

test("updateTemplate throws TemplateNotFoundError when the template belongs to a different project", async () => {
  await withTempFile(async (filePath) => {
    const created = await createTemplate(filePath, "p1", "Original", undefined, () => "t1");
    await assert.rejects(() => updateTemplate(filePath, "p2", created.id, "New name", undefined), TemplateNotFoundError);
  });
});

test("updateTemplate replaces name and startupCommand, preserving id/projectId/createdAt", async () => {
  await withTempFile(async (filePath) => {
    const created = await createTemplate(filePath, "p1", "Original", "old cmd", () => "t1");
    const updated = await updateTemplate(filePath, "p1", created.id, "Renamed", "new cmd");
    assert.equal(updated.id, created.id);
    assert.equal(updated.projectId, created.projectId);
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.name, "Renamed");
    assert.equal(updated.startupCommand, "new cmd");
  });
});

test("deleteTemplate removes only the matching id+projectId pair", async () => {
  await withTempFile(async (filePath) => {
    await createTemplate(filePath, "p1", "Keep me (other project)", undefined, () => "t-other-project");
    const target = await createTemplate(filePath, "p1", "Delete me", undefined, () => "t-target");
    await deleteTemplate(filePath, "p1", target.id);
    const remaining = await listProjectTemplates(filePath, "p1");
    assert.deepEqual(remaining.map((t) => t.id), ["t-other-project"]);
  });
});

test("deleteTemplate is a no-op when the id doesn't exist", async () => {
  await withTempFile(async (filePath) => {
    const created = await createTemplate(filePath, "p1", "Keep me", undefined, () => "t1");
    await deleteTemplate(filePath, "p1", "does-not-exist");
    const stored = await listProjectTemplates(filePath, "p1");
    assert.deepEqual(stored.map((t) => t.id), [created.id]);
  });
});
