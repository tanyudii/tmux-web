import Testing
@testable import TmuxWebClient

/// `.serialized`: every test reads/writes the same single Keychain item
/// (see KeychainStore.swift's fixed `service` string), so tests must not
/// interleave.
@Suite(.serialized)
struct KeychainStoreTests {
    init() {
        KeychainStore.deleteToken()
    }

    @Test
    func loadTokenReturnsNilWhenNothingSaved() {
        #expect(KeychainStore.loadToken() == nil)
    }

    @Test
    func saveThenLoadRoundTripsTheSameToken() throws {
        try KeychainStore.saveToken("a-very-secret-token")

        #expect(KeychainStore.loadToken() == "a-very-secret-token")
    }

    @Test
    func saveTwiceOverwritesRatherThanFailing() throws {
        try KeychainStore.saveToken("first-token")
        try KeychainStore.saveToken("second-token")

        #expect(KeychainStore.loadToken() == "second-token")
    }

    @Test
    func deleteTokenRemovesIt() throws {
        try KeychainStore.saveToken("to-be-deleted")

        KeychainStore.deleteToken()

        #expect(KeychainStore.loadToken() == nil)
    }
}
