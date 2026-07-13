import Foundation

/// Mirrors `FileStatus` in ../../src/git-status.ts
enum FileStatus: String, Codable {
    case modified, added, deleted, renamed, untracked
}

/// Mirrors `ChangedFile` in ../../src/git-status.ts
struct ChangedFile: Codable, Identifiable, Hashable {
    let path: String
    let oldPath: String?
    let status: FileStatus
    let staged: Bool

    var id: String { path }
}

/// Mirrors `GroupedChanges` in ../../src/git-status.ts
struct GroupedChanges: Codable {
    let staged: [ChangedFile]
    let unstaged: [ChangedFile]
    let untracked: [ChangedFile]
}

/// Mirrors `DiffMode` in ../../src/git-status.ts
enum DiffMode: String, Codable, CaseIterable {
    case staged, unstaged, untracked
}

/// Mirrors `FileDiff` in ../../src/git-status.ts
struct FileDiff: Codable {
    let diff: String
    let isUntracked: Bool
    let isBinary: Bool
}
