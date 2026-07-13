import Foundation

/// Intercepts requests made through a `URLSession` configured with this
/// protocol registered, so APIClientTests never touches the network.
final class StubURLProtocol: URLProtocol {
    struct Stub {
        let status: Int
        let body: Data
    }

    /// Keyed by path+query so different tests/endpoints can stub
    /// independently within the same process.
    static var stubs: [String: Stub] = [:]
    static var capturedRequests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        StubURLProtocol.capturedRequests.append(request)

        let key = (request.url?.path ?? "") + "?" + (request.url?.query ?? "")
        guard let stub = StubURLProtocol.stubs[key] ?? StubURLProtocol.stubs[request.url?.path ?? ""] else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }

        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: stub.status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func reset() {
        stubs = [:]
        capturedRequests = []
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }
}
