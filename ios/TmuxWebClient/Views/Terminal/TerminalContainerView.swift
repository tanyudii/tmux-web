import SwiftUI

/// Terminal screen: SwiftTerm view + tmux quick-keys bar + a
/// disconnected/reconnecting banner.
///
/// iOS suspends the WebSocket while the app is backgrounded (there is no
/// background execution entitlement for an arbitrary socket like this) --
/// unlike a browser tab, which can keep a WebSocket open in a background
/// tab. Reconnecting on `scenePhase == .active` re-attaches to the same
/// tmux session (see TerminalSocket.swift's `reconnect()`); tmux itself
/// keeps the session and everything running inside it alive server-side
/// the whole time, exactly like closing a browser tab does today (see
/// ../../../README.md).
struct TerminalContainerView: View {
    let client: APIClient
    let project: Project
    let session: ProjectSession

    @Environment(\.scenePhase) private var scenePhase
    @State private var coordinator = TerminalCoordinator()
    @State private var isConnected = true
    @State private var title: String?

    private var connectionInfo: TerminalConnectionInfo {
        TerminalConnectionInfo(
            baseURL: client.settings.baseURL,
            token: client.settings.token,
            sessionFullName: session.fullName
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if !isConnected {
                Label("Terputus -- menyambung ulang...", systemImage: "wifi.slash")
                    .font(.caption)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(6)
                    .background(.orange)
            }

            EnvironmentBar(client: client, projectId: project.id, sessionName: session.name)

            TerminalRepresentable(
                connectionInfo: connectionInfo,
                coordinator: coordinator,
                onBell: {},
                onTitleChange: { title = $0 },
                onConnectionStateChange: { isConnected = $0 }
            )

            QuickKeysBar { key in
                coordinator.insertText(key.sequence)
            }
        }
        .navigationTitle(title ?? session.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink {
                    ChangesListView(client: client, projectId: project.id, sessionName: session.name)
                } label: {
                    Image(systemName: "arrow.triangle.branch")
                }
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                coordinator.reconnect()
            }
        }
    }
}
