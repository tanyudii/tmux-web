import SwiftUI

enum DiffLineKind {
    case fileHeader, hunk, addition, deletion, context
}

struct DiffLine: Identifiable {
    let id: Int
    let text: String
    let kind: DiffLineKind
}

/// Mirrors `renderDiffLines` in ../../../public/app.js: color file headers
/// (`+++`/`---`), hunks (`@@`), additions (`+`), deletions (`-`), and
/// everything else as context. Pure function so it's testable without
/// SwiftUI.
func parseDiffLines(_ diffText: String) -> [DiffLine] {
    diffText.split(separator: "\n", omittingEmptySubsequences: false).enumerated().map { index, line in
        let kind: DiffLineKind
        if line.hasPrefix("+++") || line.hasPrefix("---") {
            kind = .fileHeader
        } else if line.hasPrefix("@@") {
            kind = .hunk
        } else if line.hasPrefix("+") {
            kind = .addition
        } else if line.hasPrefix("-") {
            kind = .deletion
        } else {
            kind = .context
        }
        return DiffLine(id: index, text: String(line), kind: kind)
    }
}

/// One file's diff, pushed from ChangesListView. Mirrors
/// `openDiffFor`/`renderDiffLines` in ../../../public/app.js: a binary
/// file shows a note only, an untracked file shows its raw content with
/// every line treated as an addition (there's no real diff to show), and
/// everything else renders colored diff lines.
struct DiffDetailView: View {
    let client: APIClient
    let projectId: String
    let sessionName: String
    let file: ChangedFile
    let mode: DiffMode

    @State private var diff: FileDiff?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let diff {
                content(for: diff)
            } else if errorMessage == nil {
                ProgressView()
            }
        }
        .navigationTitle(file.path)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .alert("Failed", isPresented: .constant(errorMessage != nil), presenting: errorMessage) { _ in
            Button("OK") { errorMessage = nil }
        } message: { message in
            Text(message)
        }
    }

    @ViewBuilder
    private func content(for diff: FileDiff) -> some View {
        if diff.isBinary {
            ContentUnavailableView("Binary file changed.", systemImage: "doc.fill")
        } else if diff.isUntracked {
            ScrollView([.horizontal, .vertical]) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("New file:")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 4)
                    diffLines(asAllAdditions(diff.diff))
                }
                .padding()
            }
        } else {
            ScrollView([.horizontal, .vertical]) {
                diffLines(diff.diff)
                    .padding()
            }
        }
    }

    private func asAllAdditions(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { "+" + $0 }
            .joined(separator: "\n")
    }

    @ViewBuilder
    private func diffLines(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(parseDiffLines(text)) { line in
                Text(line.text.isEmpty ? " " : line.text)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(color(for: line.kind))
            }
        }
    }

    private func color(for kind: DiffLineKind) -> Color {
        switch kind {
        case .fileHeader: return .secondary
        case .hunk: return .purple
        case .addition: return .green
        case .deletion: return .red
        case .context: return .primary
        }
    }

    private func load() async {
        do {
            diff = try await client.diff(projectId: projectId, sessionName: sessionName, filePath: file.path, mode: mode)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
