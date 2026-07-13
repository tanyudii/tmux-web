import Testing
@testable import TmuxWebClient

/// Mirrors `buildFileTree` behavior asserted against
/// ../../public/app.js's `buildFileTree`: folders sort before files, both
/// alphabetically, and nested paths group under a shared folder node.
struct FileTreeTests {
    private func file(_ path: String, status: FileStatus = .modified) -> ChangedFile {
        ChangedFile(path: path, oldPath: nil, status: status, staged: false)
    }

    @Test
    func groupsNestedPathsUnderSharedFolder() {
        let tree = buildFileTree([file("a/b.txt"), file("a/c.txt")])

        #expect(tree.count == 1)
        #expect(tree[0].name == "a")
        #expect(tree[0].isFolder)
        #expect(tree[0].children.map(\.name) == ["b.txt", "c.txt"])
    }

    @Test
    func sortsFoldersBeforeFilesAlphabetically() {
        let tree = buildFileTree([file("z.txt"), file("a/nested.txt"), file("m.txt")])

        #expect(tree.map(\.name) == ["a", "m.txt", "z.txt"])
        #expect(tree[0].isFolder)
        #expect(!tree[1].isFolder)
    }

    @Test
    func rootLevelFileHasNoChildrenAndCarriesItsChangedFile() {
        let tree = buildFileTree([file("README.md", status: .added)])

        #expect(tree.count == 1)
        #expect(tree[0].children.isEmpty)
        #expect(tree[0].file?.status == .added)
    }

    @Test
    func deeplyNestedPathBuildsMultiLevelTree() {
        let tree = buildFileTree([file("a/b/c/d.txt")])

        #expect(tree[0].name == "a")
        #expect(tree[0].children[0].name == "b")
        #expect(tree[0].children[0].children[0].name == "c")
        #expect(tree[0].children[0].children[0].children[0].name == "d.txt")
    }

    /// Regression test: an empty path (e.g. a malformed server response)
    /// used to crash `buildLevel`'s `$0.path[0]` on an empty array --
    /// buildFileTree now drops such entries instead of indexing into them.
    @Test
    func emptyPathIsDroppedInsteadOfCrashing() {
        let tree = buildFileTree([file(""), file("a.txt")])

        #expect(tree.count == 1)
        #expect(tree[0].name == "a.txt")
    }
}
