import SwiftUI

/// Lets the user navigate the server's filesystem to pick a git repo
/// directory, instead of typing an absolute path by hand (see
/// ../../src/directory-browser.ts / `GET /api/browse`).
///
/// Deliberately a single view that replaces its own state on row tap
/// (rather than pushing a `NavigationLink` per level) -- mirrors the web
/// modal's design (../../public/app.js `loadBrowseDirectory`) and avoids
/// having to pop an arbitrarily deep navigation stack back to the root once
/// a folder is chosen.
struct DirectoryBrowserView: View {
    let client: APIClient
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var currentPath: String?
    @State private var parentPath: String?
    @State private var isGitRepo = false
    @State private var entries: [DirectoryEntry] = []
    @State private var truncated = false
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let currentPath {
                    Section {
                        Text(currentPath)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                } else if entries.isEmpty && !isLoading {
                    Text("No subfolders here.").foregroundStyle(.secondary)
                } else {
                    ForEach(entries) { entry in
                        Button {
                            Task { await load(path: entry.path) }
                        } label: {
                            HStack {
                                Image(systemName: "folder")
                                Text(entry.name)
                                Spacer()
                                if entry.isGitRepo {
                                    Text("git")
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .overlay(Capsule().stroke(Color.accentColor))
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }

                if truncated {
                    Text("Showing the first entries only -- this folder has more.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Choose Folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .navigation) {
                    Button {
                        if let parentPath {
                            Task { await load(path: parentPath) }
                        }
                    } label: {
                        Label("Up", systemImage: "arrow.up")
                    }
                    .disabled(parentPath == nil)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use This Folder") {
                        if let currentPath {
                            onSelect(currentPath)
                            dismiss()
                        }
                    }
                    .disabled(!isGitRepo)
                }
            }
            .task {
                await load(path: nil)
            }
        }
    }

    private func load(path: String?) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let listing = try await client.browseDirectory(path: path)
            currentPath = listing.path
            parentPath = listing.parentPath
            isGitRepo = listing.isGitRepo
            entries = listing.entries
            truncated = listing.truncated
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
