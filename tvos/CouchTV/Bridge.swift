// The couch-tv bridge: a computer at home that stays on (README, option B). The app asks it for the
// people, the weather, Keep watching and the Apple TV's apps, and asks it to open apps, because a tvOS
// app cannot open another app by its bundle id. Its address, the pairing key and which TV this is are
// kept in the keychain.
import Foundation
import Network
import Security

struct BridgeLink: Codable, Equatable {
    var url: String          // http://192.0.2.20:5400
    var key: String          // the bridge's pairing key, empty when it has none
    var tv: String?          // this Apple TV's id in config.json
    var name: String?
}

struct BridgeError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

final class BridgeClient {
    var link: BridgeLink?
    private let session: URLSession

    init(link: BridgeLink?) {
        self.link = link
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 6
        c.timeoutIntervalForResource = 10
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: c)
    }

    /// "192.0.2.20", "192.0.2.20:5400" or "http://your-computer.local:5400/" -> http://host:port
    static func normalise(_ raw: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if !s.contains("://") { s = "http://" + s }
        guard var c = URLComponents(string: s), let host = c.host, !host.isEmpty,
              c.scheme == "http" || c.scheme == "https" else { return nil }
        if c.port == nil { c.port = 5400 }
        c.path = ""
        c.query = nil
        return c.url?.absoluteString
    }

    func url(_ path: String, _ query: [String: String] = [:], link l: BridgeLink? = nil) -> URL? {
        guard let l = l ?? link, var c = URLComponents(string: l.url + path) else { return nil }
        var q = query
        if let tv = l.tv, q["tv"] == nil { q["tv"] = tv }
        c.queryItems = q.isEmpty ? nil : q.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return c.url
    }

    /// A picture's address: a full address as it is, or a path the bridge serves (starting with /).
    func picture(_ ref: String?) -> URL? {
        guard let ref, !ref.isEmpty else { return nil }
        if ref.hasPrefix("http://") || ref.hasPrefix("https://") { return URL(string: ref) }
        guard ref.hasPrefix("/"), let l = link else { return nil }
        return URL(string: l.url + ref)
    }

    func get(_ path: String, _ query: [String: String] = [:], link l: BridgeLink? = nil) async throws -> [String: Any] {
        guard let u = url(path, query, link: l) else { throw BridgeError(status: 0, message: "no bridge set") }
        return try await send(URLRequest(url: u), link: l)
    }

    func post(_ path: String, _ body: [String: Any], link l: BridgeLink? = nil) async throws -> [String: Any] {
        guard let u = url(path, link: l) else { throw BridgeError(status: 0, message: "no bridge set") }
        var r = URLRequest(url: u)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(r, link: l)
    }

    /// A picture's bytes. The bridge's own pictures get the key as a header too.
    func data(_ u: URL) async throws -> Data {
        var r = URLRequest(url: u)
        if let l = link, u.absoluteString.hasPrefix(l.url), !l.key.isEmpty {
            r.setValue("Bearer " + l.key, forHTTPHeaderField: "Authorization")
        }
        let (d, resp) = try await session.data(for: r)
        guard ((resp as? HTTPURLResponse)?.statusCode ?? 0) == 200 else { throw BridgeError(status: 0, message: "no picture") }
        return d
    }

    private func send(_ req: URLRequest, link l: BridgeLink?) async throws -> [String: Any] {
        var r = req
        if let key = (l ?? link)?.key, !key.isEmpty { r.setValue("Bearer " + key, forHTTPHeaderField: "Authorization") }
        let (data, resp) = try await session.data(for: r)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            throw BridgeError(status: status, message: JSON.string(j["error"]) ?? "the bridge answered \(status)")
        }
        return j
    }
}

// MARK: - the keychain

enum Keychain {
    private static let service = "dev.couchtv.appletv.bridge"

    static func load() -> BridgeLink? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "bridge", kSecReturnData as String: true]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return try? JSONDecoder().decode(BridgeLink.self, from: d)
    }

    static func save(_ link: BridgeLink?) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "bridge"]
        SecItemDelete(q as CFDictionary)
        guard let link, let d = try? JSONEncoder().encode(link) else { return }
        var add = q
        add[kSecValueData as String] = d
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}

// MARK: - finding the bridge on the network (Bonjour, _couchtv._tcp, advertised by the bridge)

struct FoundBridge: Hashable, Identifiable {
    let name: String
    let url: String
    var id: String { url }
}

final class BridgeFinder {
    private var browser: NWBrowser?
    var onChange: (([FoundBridge]) -> Void)?

    func start() {
        guard browser == nil else { return }
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: "_couchtv._tcp", domain: nil), using: .tcp)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            var found: [FoundBridge] = []
            for r in results {
                guard case let .bonjour(txt) = r.metadata, let ip = txt["ip"], let port = txt["port"],
                      let url = BridgeClient.normalise("\(ip):\(port)") else { continue }
                var name = "couch-tv bridge"
                if case let .service(n, _, _, _) = r.endpoint { name = n }
                found.append(FoundBridge(name: name, url: url))
            }
            DispatchQueue.main.async { self?.onChange?(found) }
        }
        b.start(queue: .main)
        browser = b
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }
}
