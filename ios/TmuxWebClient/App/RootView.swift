import SwiftUI

struct RootView: View {
    @EnvironmentObject private var settingsStore: ConnectionSettingsStore

    var body: some View {
        if let settings = settingsStore.current {
            NavigationStack {
                ProjectListView(client: APIClient(settings: settings))
            }
        } else {
            ConnectionSettingsView()
        }
    }
}
