import SwiftUI

struct ProjectListView: View {
    let client: APIClient

    @EnvironmentObject private var settingsStore: ConnectionSettingsStore
    @State private var projects: [Project] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var isShowingNewProjectSheet = false
    /// Set when a delete came back 409 (project still has active sessions)
    /// -- see DirtyWorktreeError/"Project has active sessions" handling in
    /// ../../src/server.ts. Confirming re-issues the delete with `force`.
    @State private var pendingForceDelete: (project: Project, message: String)?

    var body: some View {
        List {
            ForEach(projects) { project in
                NavigationLink(value: project) {
                    VStack(alignment: .leading) {
                        Text(project.name).font(.headline)
                        Text(project.repoPath)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            .onDelete { indexSet in
                Task { await delete(at: indexSet) }
            }
        }
        .navigationDestination(for: Project.self) { project in
            SessionListView(client: client, project: project)
        }
        .navigationTitle("Projects")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { isShowingNewProjectSheet = true } label: {
                    Image(systemName: "plus")
                }
            }
            ToolbarItem(placement: .cancellationAction) {
                Button("Switch Server") { settingsStore.clear() }
            }
        }
        .sheet(isPresented: $isShowingNewProjectSheet) {
            NewProjectSheet(client: client) { project in
                projects.append(project)
            }
        }
        .alert("Failed", isPresented: .constant(errorMessage != nil), presenting: errorMessage) { _ in
            Button("OK") { errorMessage = nil }
        } message: { message in
            Text(message)
        }
        .alert(
            "Delete project?",
            isPresented: .init(
                get: { pendingForceDelete != nil },
                set: { if !$0 { pendingForceDelete = nil } }
            ),
            presenting: pendingForceDelete
        ) { pending in
            Button("Force Delete", role: .destructive) {
                Task { await forceDelete(pending.project) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { pending in
            Text(pending.message)
        }
        .refreshable { await load() }
        .task { await load() }
        .overlay {
            if isLoading && projects.isEmpty {
                ProgressView()
            } else if projects.isEmpty {
                ContentUnavailableView("No projects yet", systemImage: "folder", description: Text("Add a project using the + button"))
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            projects = try await client.listProjects()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func delete(at indexSet: IndexSet) async {
        for index in indexSet {
            let project = projects[index]
            do {
                try await client.deleteProject(id: project.id)
                projects.removeAll { $0.id == project.id }
            } catch APIError.conflict(let message, _) {
                pendingForceDelete = (project, message)
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func forceDelete(_ project: Project) async {
        do {
            try await client.deleteProject(id: project.id, force: true)
            projects.removeAll { $0.id == project.id }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
