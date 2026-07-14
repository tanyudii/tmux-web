import SwiftUI

struct ConnectionSettingsView: View {
    @EnvironmentObject private var settingsStore: ConnectionSettingsStore

    @State private var serverURLText = "http://"
    @State private var token = ""
    @State private var isTesting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("http://<vpn-host>:5309", text: $serverURLText)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("tmux-web Server")
                } footer: {
                    Text("This server is only reachable over your VPN (WireGuard/Tailscale/etc.) -- see the main tmux-web README for the security model.")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await testAndSave() }
                    } label: {
                        if isTesting {
                            ProgressView()
                        } else {
                            Text("Connect")
                        }
                    }
                    .disabled(isTesting || serverURLText.isEmpty || token.isEmpty)
                }
            }
            .navigationTitle("Setup")
        }
    }

    private func testAndSave() async {
        errorMessage = nil
        guard let url = URL(string: serverURLText), url.scheme != nil, url.host != nil else {
            errorMessage = "Invalid server URL."
            return
        }

        isTesting = true
        defer { isTesting = false }

        let candidate = ConnectionSettings(baseURL: url, token: token)
        do {
            _ = try await APIClient(settings: candidate).listProjects()
            try settingsStore.save(baseURL: url, token: token)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
