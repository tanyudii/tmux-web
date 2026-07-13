import Foundation

/// Server URL is not a secret so it lives in UserDefaults; the token does
/// (see KeychainStore.swift). Mirrors what the browser UI keeps in
/// localStorage, but split across two stores by sensitivity.
struct ConnectionSettings: Equatable {
    var baseURL: URL
    var token: String
}

final class ConnectionSettingsStore: ObservableObject {
    private static let baseURLKey = "tmuxweb.baseURL"

    @Published private(set) var current: ConnectionSettings?

    init() {
        current = Self.load()
    }

    func save(baseURL: URL, token: String) throws {
        UserDefaults.standard.set(baseURL.absoluteString, forKey: Self.baseURLKey)
        try KeychainStore.saveToken(token)
        current = ConnectionSettings(baseURL: baseURL, token: token)
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: Self.baseURLKey)
        KeychainStore.deleteToken()
        current = nil
    }

    private static func load() -> ConnectionSettings? {
        guard
            let urlString = UserDefaults.standard.string(forKey: baseURLKey),
            let baseURL = URL(string: urlString),
            let token = KeychainStore.loadToken()
        else {
            return nil
        }
        return ConnectionSettings(baseURL: baseURL, token: token)
    }
}
