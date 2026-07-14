import SwiftUI

/// Creating a session runs `git fetch origin` + `git worktree add` + a tmux
/// session create server-side (see ../../../src/worktree.ts), which can
/// take several seconds on a large repo or slow connection. The server
/// returns fast (202 Accepted) and does the actual work in the background
/// (see startProjectSessionCreation in ../../../src/project-sessions.ts),
/// so this sheet stays open showing a live progress message -- polled the
/// same way EnvironmentBar.swift polls env status -- and only dismisses
/// once creation reaches phase "ready".
struct NewSessionSheet: View {
    let client: APIClient
    let project: Project
    let onCreated: (ProjectSession) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var isSaving = false
    @State private var progressMessage: String?
    @State private var errorMessage: String?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Session name (becomes the git branch name)", text: $name)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                if isSaving {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text(progressMessage ?? "Membuat session…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle("New Session")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await save() }
                    }
                    .disabled(name.isEmpty || isSaving)
                }
            }
        }
        // Mirrors EnvironmentBar.swift's self-cancelling `.task` loop, but
        // triggered on demand (from save() below) rather than running for
        // the view's whole lifetime -- so the poll `Task` is stored here
        // purely so a manual dismiss mid-poll (e.g. swipe-to-dismiss) can
        // still cancel it.
        .onDisappear { pollTask?.cancel() }
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        progressMessage = nil
        do {
            let pending = try await client.startSessionCreation(projectId: project.id, name: name)
            let task = Task { await pollCreationStatus(sessionSlug: pending.name) }
            pollTask = task
            await task.value
        } catch {
            isSaving = false
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Polls GET .../sessions/:name/creation every second -- session
    /// creation is much shorter-lived than a docker-compose environment, so
    /// this ticks faster than EnvironmentBar's 3s env poll.
    private func pollCreationStatus(sessionSlug: String) async {
        while !Task.isCancelled {
            do {
                let status = try await client.sessionCreationStatus(projectId: project.id, sessionName: sessionSlug)
                progressMessage = status.message

                switch status.phase {
                case .ready:
                    // The backend contract guarantees `session` is present
                    // once phase is "ready" -- see getSessionCreationStatus
                    // in ../../../src/project-sessions.ts.
                    if let session = status.session {
                        onCreated(session)
                    }
                    isSaving = false
                    dismiss()
                    return
                case .error:
                    isSaving = false
                    errorMessage = status.message
                    return
                case .creating:
                    break
                }
            } catch {
                // The poll request itself failed (network hiccup, or the
                // in-memory store was wiped by a server restart) -- surface
                // it and let the user retry rather than polling forever.
                isSaving = false
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                return
            }

            try? await Task.sleep(for: .seconds(1))
        }
    }
}
