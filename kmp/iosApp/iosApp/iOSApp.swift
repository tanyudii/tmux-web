import SwiftUI
import ComposeApp

@main
struct IOSApp: App {
    init() {
        // Must run before ContentView() creates MainViewController() — Compose
        // reads TerminalViewProvider.factory the first time PlatformTerminalView
        // composes. See composeApp's TerminalViewFactory.kt for the contract.
        TerminalViewProvider.shared.factory = SwiftTermViewFactory()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea(.keyboard)
        }
    }
}
