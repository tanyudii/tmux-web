import SwiftUI

@main
struct TmuxWebClientApp: App {
    @StateObject private var settingsStore = ConnectionSettingsStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(settingsStore)
        }
    }
}
