import SwiftUI

struct SessionListView: View {
    let client: APIClient
    let project: Project

    @State private var sessions: [ProjectSession] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var isShowingNewSessionSheet = false
    /// Set on 409 -- the session's worktree has uncommitted changes (see
    /// DirtyWorktreeError in ../../src/worktree.ts). tmux-web never
    /// silently discards work, so this always requires an explicit
    /// force-confirm, same as the browser UI.
    @State private var pendingForceDelete: (session: ProjectSession, message: String)?

    var body: some View {
        List {
            ForEach(sessions) { session in
                NavigationLink(value: session) {
                    VStack(alignment: .leading) {
                        Text(session.name).font(.headline)
                        Text("\(session.windows) window\(session.windows == 1 ? "" : "s")" + (session.attached ? " · attached" : ""))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .onDelete { indexSet in
                Task { await delete(at: indexSet) }
            }
        }
        .navigationDestination(for: ProjectSession.self) { session in
            TerminalContainerView(client: client, project: project, session: session)
        }
        .navigationTitle(project.name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { isShowingNewSessionSheet = true } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $isShowingNewSessionSheet) {
            NewSessionSheet(client: client, project: project) { session in
                sessions.append(session)
            }
        }
        .alert("Gagal", isPresented: .constant(errorMessage != nil), presenting: errorMessage) { _ in
            Button("OK") { errorMessage = nil }
        } message: { message in
            Text(message)
        }
        .alert(
            "Ada perubahan belum di-commit",
            isPresented: .init(
                get: { pendingForceDelete != nil },
                set: { if !$0 { pendingForceDelete = nil } }
            ),
            presenting: pendingForceDelete
        ) { pending in
            Button("Hapus Paksa (buang perubahan)", role: .destructive) {
                Task { await forceDelete(pending.session) }
            }
            Button("Batal", role: .cancel) {}
        } message: { pending in
            Text(pending.message)
        }
        .refreshable { await load() }
        .task { await load() }
        .overlay {
            if isLoading && sessions.isEmpty {
                ProgressView()
            } else if sessions.isEmpty {
                ContentUnavailableView("Belum ada session", systemImage: "terminal", description: Text("Buat session baru lewat tombol +"))
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            sessions = try await client.listSessions(projectId: project.id)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func delete(at indexSet: IndexSet) async {
        for index in indexSet {
            let session = sessions[index]
            do {
                try await client.deleteSession(projectId: project.id, sessionName: session.name)
                sessions.removeAll { $0.id == session.id }
            } catch APIError.conflict(let message, _) {
                pendingForceDelete = (session, message)
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func forceDelete(_ session: ProjectSession) async {
        do {
            try await client.deleteSession(projectId: project.id, sessionName: session.name, force: true)
            sessions.removeAll { $0.id == session.id }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
