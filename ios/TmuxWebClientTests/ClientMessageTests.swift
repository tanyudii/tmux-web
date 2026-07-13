import Testing
import Foundation
@testable import TmuxWebClient

/// Mirrors ../../src/pty-bridge.test.ts's coverage of `parseClientMessage`,
/// applied to the Swift encoder/decoder that has to produce/accept the
/// exact same wire shape.
struct ClientMessageTests {
    private func jsonObject(from data: Data) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test
    func encodeInputProducesExpectedJSON() throws {
        let data = try ClientMessage.input("ls\n").encoded()

        let object = try jsonObject(from: data)

        #expect(object["type"] as? String == "input")
        #expect(object["data"] as? String == "ls\n")
    }

    @Test
    func encodeResizeProducesExpectedJSON() throws {
        let data = try ClientMessage.resize(cols: 100, rows: 40).encoded()

        let object = try jsonObject(from: data)

        #expect(object["type"] as? String == "resize")
        #expect(object["cols"] as? Int == 100)
        #expect(object["rows"] as? Int == 40)
    }

    @Test
    func decodeValidInputMessage() {
        let data = Data(#"{"type":"input","data":"ls\n"}"#.utf8)

        #expect(ClientMessage.decode(data) == .input("ls\n"))
    }

    @Test
    func decodeValidResizeMessage() {
        let data = Data(#"{"type":"resize","cols":100,"rows":40}"#.utf8)

        #expect(ClientMessage.decode(data) == .resize(cols: 100, rows: 40))
    }

    @Test
    func decodeMalformedJSONReturnsNil() {
        #expect(ClientMessage.decode(Data("not json".utf8)) == nil)
    }

    @Test
    func decodeUnknownTypeReturnsNil() {
        let data = Data(#"{"type":"eval","data":"rm -rf /"}"#.utf8)

        #expect(ClientMessage.decode(data) == nil)
    }

    @Test
    func decodeMissingInputDataReturnsNil() {
        let data = Data(#"{"type":"input"}"#.utf8)

        #expect(ClientMessage.decode(data) == nil)
    }

    @Test(arguments: [
        (#"{"type":"resize","cols":0,"rows":24}"#),
        (#"{"type":"resize","cols":80,"rows":-1}"#),
    ])
    func decodeZeroOrNegativeResizeDimensionsReturnsNil(json: String) {
        #expect(ClientMessage.decode(Data(json.utf8)) == nil)
    }

    @Test
    func encodeThenDecodeRoundTrips() throws {
        let original = ClientMessage.input("echo hi")

        let decoded = ClientMessage.decode(try original.encoded())

        #expect(decoded == original)
    }
}
