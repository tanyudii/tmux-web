import Foundation

/// Mirrors `DirectoryEntry` in ../../src/directory-browser.ts
struct DirectoryEntry: Codable, Identifiable, Hashable {
    let name: String
    let path: String
    let isGitRepo: Bool

    var id: String { path }
}

/// Mirrors `DirectoryListing` in ../../src/directory-browser.ts
/// (`GET /api/browse` response body).
struct DirectoryBrowseResponse: Codable {
    let path: String
    let parentPath: String?
    let isGitRepo: Bool
    let entries: [DirectoryEntry]
    let truncated: Bool
}
