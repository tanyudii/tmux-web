// Ports kmp/composeApp/.../domain/FileTreeNode.kt -- groups a flat
// ChangedFile list into a folder tree. Mirrors `buildFileTree`/
// `renderTreeChildren` in public/app.js and FileTree.swift: folders sort
// before files, both alphabetically.
import type { ChangedFile } from "../api/types";

export interface FileTreeNode {
  name: string;
  children: FileTreeNode[];
  file: ChangedFile | null;
  id: string;
  isFolder: boolean;
}

function makeNode(name: string, children: FileTreeNode[], file: ChangedFile | null): FileTreeNode {
  return { name, children, file, id: file?.path ?? name, isFolder: file === null };
}

/** Pure function so tree-grouping logic is testable in isolation from any UI layer. */
export function buildFileTree(files: ChangedFile[]): FileTreeNode[] {
  const entries = files
    .map((file): [string[], ChangedFile] => [file.path.split("/").filter((segment) => segment.length > 0), file])
    // A path that splits to an empty list (e.g. an empty string) can't be
    // rendered as a tree node -- dropped defensively. Not currently
    // reachable via `git status --porcelain` (paths are never empty
    // there), but ChangedFile.path is server-decoded JSON with no
    // type-level non-emptiness guarantee.
    .filter(([segments]) => segments.length > 0);
  return buildLevel(entries);
}

function buildLevel(entries: [string[], ChangedFile][]): FileTreeNode[] {
  const grouped = new Map<string, [string[], ChangedFile][]>();
  for (const entry of entries) {
    const [segments] = entry;
    const name = segments[0];
    const group = grouped.get(name);
    if (group) group.push(entry);
    else grouped.set(name, [entry]);
  }

  const nodes = Array.from(grouped.entries()).map(([name, group]) => {
    const leaf = group.find(([segments]) => segments.length === 1);
    const deeper: [string[], ChangedFile][] = group
      .filter(([segments]) => segments.length > 1)
      .map(([segments, file]) => [segments.slice(1), file]);

    return makeNode(name, buildLevel(deeper), leaf ? leaf[1] : null);
  });

  return nodes.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    // Ordinal comparison (not localeCompare) to match Kotlin's String.compareTo exactly.
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}
