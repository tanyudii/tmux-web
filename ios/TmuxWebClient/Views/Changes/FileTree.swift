import Foundation

/// One node in the folder tree `buildFileTree` groups a flat `ChangedFile`
/// list into. `file` is set only on leaf (file) nodes; folder nodes carry
/// `nil` and derive their children from every path that shares their
/// prefix. Mirrors `buildFileTree`/`renderTreeChildren` in
/// ../../../public/app.js -- folders sort before files, both
/// alphabetically.
struct FileTreeNode: Identifiable, Hashable {
    let name: String
    let children: [FileTreeNode]
    let file: ChangedFile?

    var id: String { file?.id ?? name }
    var isFolder: Bool { file == nil }
}

/// Pure function (no SwiftUI dependency) so tree-grouping logic is
/// testable in isolation from the rendering layer -- see
/// ChangesListView.swift for the consumer.
func buildFileTree(_ files: [ChangedFile]) -> [FileTreeNode] {
    let entries = files
        .map { (path: $0.path.split(separator: "/").map(String.init), file: $0) }
        // A path that splits to an empty array (e.g. an empty string) would
        // crash buildLevel's `$0.path[0]` below -- drop it defensively since
        // an empty path can't be rendered as a tree node anyway. Not
        // currently reachable via `git status --porcelain` (paths are never
        // empty there), but ChangedFile.path is server-decoded JSON with no
        // type-level non-emptiness guarantee.
        .filter { !$0.path.isEmpty }
    return buildLevel(entries)
}

private func buildLevel(_ entries: [(path: [String], file: ChangedFile)]) -> [FileTreeNode] {
    let grouped = Dictionary(grouping: entries, by: { $0.path[0] })

    let nodes = grouped.map { name, group -> FileTreeNode in
        let leaf = group.first { $0.path.count == 1 }
        let deeper = group
            .filter { $0.path.count > 1 }
            .map { (path: Array($0.path.dropFirst()), file: $0.file) }

        return FileTreeNode(name: name, children: buildLevel(deeper), file: leaf?.file)
    }

    return nodes.sorted { lhs, rhs in
        if lhs.isFolder != rhs.isFolder { return lhs.isFolder }
        return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
    }
}
