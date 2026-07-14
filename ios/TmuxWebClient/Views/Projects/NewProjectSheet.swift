import SwiftUI

struct NewProjectSheet: View {
    let client: APIClient
    let onCreated: (Project) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var repoPath = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Project name", text: $name)
                    .textInputAutocapitalization(.never)
                TextField("Absolute path to the git repo", text: $repoPath)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle("New Project")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(name.isEmpty || repoPath.isEmpty || isSaving)
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let project = try await client.createProject(name: name, repoPath: repoPath)
            onCreated(project)
            dismiss()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
