import Foundation
import SwiftUI

struct NewProjectSheet: View {
    let client: APIClient
    let onCreated: (Project) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var repoPath = ""
    @State private var nameWasEdited = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var isShowingBrowser = false

    var body: some View {
        NavigationStack {
            Form {
                // Custom binding (not onChange(of: name)) so only a real
                // keystroke from the user marks the name as edited --
                // onChange would also fire for the programmatic auto-fill
                // below, since it can't tell the two apart.
                TextField("Project name", text: Binding(
                    get: { name },
                    set: { newValue in
                        name = newValue
                        nameWasEdited = true
                    }
                ))
                .textInputAutocapitalization(.never)

                Button {
                    isShowingBrowser = true
                } label: {
                    HStack {
                        Text("Folder")
                        Spacer()
                        Text(repoPath.isEmpty ? "Choose..." : repoPath)
                            .foregroundStyle(repoPath.isEmpty ? .secondary : .primary)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                }
                .buttonStyle(.plain)

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
            .sheet(isPresented: $isShowingBrowser) {
                DirectoryBrowserView(client: client) { chosenPath in
                    repoPath = chosenPath
                    // Prefill the name from the folder if the user hasn't
                    // typed one yet -- same UX as the web modal
                    // (../../public/app.js `browseNameTouched`).
                    if !nameWasEdited {
                        name = (chosenPath as NSString).lastPathComponent
                    }
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
