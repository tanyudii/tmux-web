import SwiftUI

/// Git changes sidebar, ported from ../../../public/app.js's right-hand
/// changes panel (see ../../../README.md). Three sections
/// (staged/unstaged/untracked) built from `GroupedChanges`, each grouped
/// into a folder tree via FileTree.swift. Polled every 5s while visible
/// (`changesPollTimer` there, a self-cancelling `.task` loop here) plus
/// pull-to-refresh, mirroring the `.refreshable` convention already used
/// in SessionListView.swift.
///
/// Unlike the web sidebar's inline single-expand-at-a-time diff panel,
/// tapping a file here pushes a `DiffDetailView` -- a permanent side
/// panel doesn't fit an iPhone's width, and push navigation gives "one
/// diff open at a time" for free without tracking an expanded-key state.
struct ChangesListView: View {
    let client: APIClient
    let projectId: String
    let sessionName: String

    @State private var changes: GroupedChanges?
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let changes {
                group("Staged", files: changes.staged, mode: .staged)
                group("Unstaged", files: changes.unstaged, mode: .unstaged)
                group("Untracked", files: changes.untracked, mode: .untracked)
            }
        }
        .navigationTitle("Changes")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if let changes, changes.staged.isEmpty, changes.unstaged.isEmpty, changes.untracked.isEmpty {
                ContentUnavailableView("Tidak ada perubahan", systemImage: "checkmark.circle")
            }
        }
        .refreshable { await load() }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(5))
            }
        }
        .alert("Gagal", isPresented: .constant(errorMessage != nil), presenting: errorMessage) { _ in
            Button("OK") { errorMessage = nil }
        } message: { message in
            Text(message)
        }
    }

    @ViewBuilder
    private func group(_ title: String, files: [ChangedFile], mode: DiffMode) -> some View {
        if !files.isEmpty {
            Section(title) {
                ForEach(buildFileTree(files)) { node in
                    FileTreeRow(node: node, mode: mode, client: client, projectId: projectId, sessionName: sessionName)
                }
            }
        }
    }

    private func load() async {
        do {
            changes = try await client.changes(projectId: projectId, sessionName: sessionName)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

/// `body` is `AnyView`, not `some View` -- this struct references itself
/// recursively (a folder's children can contain more `FileTreeRow`s), and
/// an opaque `some View` return type can't resolve to a type that
/// contains itself. Erasing to `AnyView` at this one recursive boundary
/// breaks that cycle.
private struct FileTreeRow: View {
    let node: FileTreeNode
    let mode: DiffMode
    let client: APIClient
    let projectId: String
    let sessionName: String

    var body: AnyView {
        if node.isFolder {
            return AnyView(
                DisclosureGroup("📁 \(node.name)") {
                    ForEach(node.children) { child in
                        FileTreeRow(node: child, mode: mode, client: client, projectId: projectId, sessionName: sessionName)
                    }
                }
            )
        }

        guard let file = node.file else {
            return AnyView(EmptyView())
        }

        let style = statusStyle(file.status)
        return AnyView(
            NavigationLink {
                DiffDetailView(client: client, projectId: projectId, sessionName: sessionName, file: file, mode: mode)
            } label: {
                Label {
                    Text(node.name)
                } icon: {
                    Image(systemName: style.symbol).foregroundStyle(style.color)
                }
            }
        )
    }

    private func statusStyle(_ status: FileStatus) -> (symbol: String, color: Color) {
        switch status {
        case .added: return ("plus.circle.fill", .green)
        case .modified: return ("pencil.circle.fill", .yellow)
        case .deleted: return ("minus.circle.fill", .red)
        case .renamed: return ("arrow.triangle.swap", .blue)
        case .untracked: return ("questionmark.circle.fill", .secondary)
        }
    }
}
