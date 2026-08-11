import { describe, expect, test } from "vitest";
import type { ChangedFile, FileStatus } from "../api/types";
import { buildFileTree } from "./fileTree";

// Ports kmp/.../domain/FileTreeTest.kt 1:1 (itself a port of
// ios/TmuxWebClientTests/FileTreeTests.swift / public/app.js's buildFileTree).
function file(path: string, status: FileStatus = "modified"): ChangedFile {
  return { path, status, staged: false, conflicted: false };
}

describe("buildFileTree", () => {
  test("groups nested paths under shared folder", () => {
    const tree = buildFileTree([file("a/b.txt"), file("a/c.txt")]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("a");
    expect(tree[0].isFolder).toBe(true);
    expect(tree[0].children.map((child) => child.name)).toEqual(["b.txt", "c.txt"]);
  });

  test("sorts folders before files alphabetically", () => {
    const tree = buildFileTree([file("z.txt"), file("a/nested.txt"), file("m.txt")]);

    expect(tree.map((node) => node.name)).toEqual(["a", "m.txt", "z.txt"]);
    expect(tree[0].isFolder).toBe(true);
    expect(tree[1].isFolder).toBe(false);
  });

  test("root level file has no children and carries its changed file", () => {
    const tree = buildFileTree([file("README.md", "added")]);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toEqual([]);
    expect(tree[0].file?.status).toBe("added");
  });

  test("deeply nested path builds multi level tree", () => {
    const tree = buildFileTree([file("a/b/c/d.txt")]);

    expect(tree[0].name).toBe("a");
    expect(tree[0].children[0].name).toBe("b");
    expect(tree[0].children[0].children[0].name).toBe("c");
    expect(tree[0].children[0].children[0].children[0].name).toBe("d.txt");
  });

  test("empty path is dropped instead of crashing", () => {
    const tree = buildFileTree([file(""), file("a.txt")]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("a.txt");
  });
});
