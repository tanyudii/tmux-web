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
                    Text("Server tmux-web")
                } footer: {
                    Text("Server ini hanya bisa dicapai lewat VPN Anda (WireGuard/Tailscale/dll) -- lihat README utama tmux-web untuk model keamanannya.")
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
                            Text("Hubungkan")
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
            errorMessage = "URL server tidak valid."
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
