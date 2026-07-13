import Testing
@testable import TmuxWebClient

/// Mirrors `renderDiffLines` behavior asserted against
/// ../../public/app.js: file headers, hunks, additions, deletions, and
/// context lines each get a distinct `DiffLineKind`.
struct DiffDetailViewTests {
    @Test
    func classifiesEachDiffLineKind() {
        let text = [
            "--- a/file.txt",
            "+++ b/file.txt",
            "@@ -1,2 +1,2 @@",
            "-old line",
            "+new line",
            " unchanged line",
        ].joined(separator: "\n")

        let lines = parseDiffLines(text)

        #expect(lines.map(\.kind) == [.fileHeader, .fileHeader, .hunk, .deletion, .addition, .context])
    }

    @Test
    func emptyLineIsContext() {
        let lines = parseDiffLines("")
        #expect(lines.map(\.kind) == [.context])
    }
}
