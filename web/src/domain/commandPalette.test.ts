import { describe, expect, it } from "vitest";
import { buildCommandPaletteItems, filterAndRankItems } from "./commandPalette";
import type { Project, ProjectSession } from "../api/types";

function project(overrides: Partial<Project> = {}): Project {
  return { id: "p1", name: "demo-app", repoPath: "/repo", createdAt: "2024-01-01T00:00:00Z", ...overrides };
}

function session(overrides: Partial<ProjectSession> = {}): ProjectSession {
  return { name: "main", fullName: "p1__main", windows: 1, windowNames: [], attached: false, label: null, favorite: false, ...overrides };
}

describe("buildCommandPaletteItems", () => {
  it("builds one entry per project", () => {
    const items = buildCommandPaletteItems([project()], {});
    expect(items).toEqual([{ kind: "project", id: "project:p1", projectId: "p1", label: "demo-app", sublabel: null }]);
  });

  it("falls back to the project id when name is blank", () => {
    const items = buildCommandPaletteItems([project({ name: "  " })], {});
    expect(items[0]?.label).toBe("p1");
  });

  it("builds one entry per session, with the project name as sublabel", () => {
    const items = buildCommandPaletteItems([project()], { p1: [session()] });
    expect(items).toContainEqual({
      kind: "session",
      id: "session:p1:main",
      projectId: "p1",
      sessionName: "main",
      label: "main",
      sublabel: "demo-app",
    });
  });

  it("omits sessions for projects with no entry in sessionsByProjectId", () => {
    const items = buildCommandPaletteItems([project()], {});
    expect(items).toHaveLength(1);
  });

  it("lists project entries before session entries", () => {
    const items = buildCommandPaletteItems([project()], { p1: [session()] });
    expect(items.map((i) => i.kind)).toEqual(["project", "session"]);
  });
});

describe("filterAndRankItems", () => {
  const items = buildCommandPaletteItems([project({ id: "p1", name: "demo-app" }), project({ id: "p2", name: "other-app" })], {
    p1: [session({ name: "main" }), session({ name: "worker" })],
  });

  it("returns every item for an empty query", () => {
    expect(filterAndRankItems(items, "")).toHaveLength(4);
  });

  it("matches by label via fuzzy subsequence", () => {
    const result = filterAndRankItems(items, "dmap");
    expect(result.map((i) => i.label)).toContain("demo-app");
  });

  it("matches a session by its project's sublabel, not just its own label", () => {
    const result = filterAndRankItems(items, "demo-app");
    expect(result.map((i) => i.label)).toEqual(expect.arrayContaining(["demo-app", "main", "worker"]));
  });

  it("ranks an exact substring match above a scattered subsequence match", () => {
    // "main" is an exact substring of the session "main"; "other-app" only
    // fuzzy-subsequence-matches "man" via scattered letters, so it must not
    // outrank the exact hit.
    const result = filterAndRankItems(items, "main");
    expect(result[0]?.label).toBe("main");
  });

  it("excludes items that don't match at all", () => {
    const result = filterAndRankItems(items, "zzz-no-match");
    expect(result).toHaveLength(0);
  });
});
