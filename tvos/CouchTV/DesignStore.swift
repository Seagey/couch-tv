// Which couch-tv Studio design the home shows, and getting one by code. A design in config.json comes from
// the bridge (GET /api/config, "design"). A design got by code at this Apple TV wins over it, and is always
// asked about first ("Use this design?"): arriving clears any yes given before, so nothing in the answer can
// skip the question. Plain home (Settings) turns designs off until a new one is got by code. The design got
// by code is kept in a file and in the app's settings, so it is still there after a restart.
import Foundation

extension HomeModel {
    /// The design on the home now, or nil for the home as it always was.
    var design: Design? {
        if designOff || kidsOn { return nil }
        return keptDesign ?? configDesign
    }

    /// Any design this Apple TV could show (for Settings: a way back from Plain home).
    var hasDesign: Bool { keptDesign != nil || configDesign != nil }

    /// config.json's design and design store, as the bridge sends them.
    func readDesign(config cfg: [String: Any]) {
        designStore = DesignCode.store(config: cfg)
        if let raw = cfg["design"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: raw) {
            if data != configDesignJSON {
                configDesignJSON = data
                configDesign = Design.read(raw)
            }
        } else {
            configDesignJSON = nil
            configDesign = nil
        }
    }

    // MARK: getting a design by code (tv-home/web/design-code.js)

    /// Ask couch-tv Studio's store for the design behind a code. Returns what went wrong, or nil when the
    /// design arrived (it then waits for "Use this design?").
    func getDesign(code typed: String) async -> String? {
        guard let code = DesignCode.read(typed) else { return DesignCode.notACode }
        guard let base = designStore, let url = URL(string: base + "/v1/designs/fetch") else {
            return "Getting a design by code is switched off on the bridge (config.json design_store)."
        }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpShouldHandleCookies = false
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code])
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 15
        c.timeoutIntervalForResource = 20
        c.httpCookieStorage = nil
        c.urlCache = nil
        let session = URLSession(configuration: c, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        do {
            let (data, resp) = try await session.data(for: r)
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else { return DesignCode.message(status: status) }
            guard let raw = DesignCode.accept(data), let d = Design.read(raw),
                  let keep = try? JSONSerialization.data(withJSONObject: raw) else { return DesignCode.badDesign }
            pendingDesign = d
            designOff = false
            UserDefaults.standard.set(false, forKey: "design.off")
            saveCodeDesign(keep, ok: false)
            return nil
        } catch {
            return DesignCode.message(status: 0)
        }
    }

    /// The answer to "Use this design?". Yes shows it; No keeps the home as it was and forgets it.
    func useDesign(_ yes: Bool) {
        guard let d = pendingDesign else { return }
        pendingDesign = nil
        if yes {
            keptDesign = d
            if let data = Self.readCodeDesign()?.data { saveCodeDesign(data, ok: true) }
        } else {
            forgetCodeDesign()
            say("Your home stays as it was.", for: 4)
        }
    }

    /// Plain home: the home as it always was, until a design is got by code or turned back on.
    func setPlainHome(_ on: Bool) {
        designOff = on
        UserDefaults.standard.set(on, forKey: "design.off")
    }

    // MARK: keeping it

    private static let fileName = "design-by-code.json"
    private static let defaultsKey = "design.by-code"
    private static let okKey = "design.by-code.ok"

    private static var file: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent(fileName)
    }

    func saveCodeDesign(_ data: Data, ok: Bool) {
        if let f = Self.file { try? data.write(to: f, options: .atomic) }
        // tvOS keeps app settings small: the copy there leaves out a large picture (the file has it)
        var copy = data
        if data.count > 400_000, var raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            if var bg = raw["background"] as? [String: Any], (bg["image"] as? String)?.hasPrefix("data:") == true {
                bg.removeValue(forKey: "image")
                bg["colour"] = bg["colour"] ?? "#101014"
                raw["background"] = bg
            }
            copy = (try? JSONSerialization.data(withJSONObject: raw)) ?? Data()
        }
        UserDefaults.standard.set(copy.count <= 400_000 ? copy : nil, forKey: Self.defaultsKey)
        UserDefaults.standard.set(ok, forKey: Self.okKey)
    }

    static func readCodeDesign() -> (data: Data, ok: Bool)? {
        let ok = UserDefaults.standard.bool(forKey: okKey)
        if let f = file, let d = try? Data(contentsOf: f) { return (d, ok) }
        if let d = UserDefaults.standard.data(forKey: defaultsKey) { return (d, ok) }
        return nil
    }

    func forgetCodeDesign() {
        if let f = Self.file { try? FileManager.default.removeItem(at: f) }
        UserDefaults.standard.removeObject(forKey: Self.defaultsKey)
        UserDefaults.standard.removeObject(forKey: Self.okKey)
    }

    /// At start: a design said yes to shows; one not yet answered asks again.
    func restoreDesign() {
        guard let kept = Self.readCodeDesign() else { return }
        // read through the store's own check and the gate again, as for a new answer
        let wrapped = (try? JSONSerialization.data(withJSONObject: ["design": (try? JSONSerialization.jsonObject(with: kept.data)) ?? [:]])) ?? Data()
        guard let raw = DesignCode.accept(wrapped), let d = Design.read(raw) else { forgetCodeDesign(); return }
        if kept.ok { keptDesign = d } else { pendingDesign = d }
    }
}

// MARK: Get a design from your phone (tv-home/web/design-code.js openInbox, takeInbox)

extension HomeModel {
    private func inboxCall(_ body: [String: String]) async -> (Int, Data)? {
        guard let base = designStore, let url = URL(string: base + "/api/inbox") else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        r.httpShouldHandleCookies = false
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 15
        c.httpCookieStorage = nil
        c.urlCache = nil
        let session = URLSession(configuration: c, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        guard let (data, resp) = try? await session.data(for: r) else { return nil }
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    /// A new inbox, or what went wrong in plain words.
    func openInbox() async -> Result<DesignInbox, InboxProblem> {
        guard let base = designStore else { return .failure(InboxProblem(words: "Getting a design is switched off on the bridge (config.json design_store).")) }
        guard let (status, data) = await inboxCall(["op": "open"]) else {
            return .failure(InboxProblem(words: "Could not reach couch-tv Studio. Check the Apple TV is online, or type the code instead."))
        }
        // a store with no inbox (an older couch-tv Studio, or one's own store) answers 404
        if status == 404 { return .failure(InboxProblem(words: "This design store has no phone inbox. Type the code instead.")) }
        guard status == 200, let box = DesignInbox.read(data, base: base) else {
            return .failure(InboxProblem(words: "couch-tv Studio is busy. Type the code instead, or try again in a few minutes."))
        }
        return .success(box)
    }

    func takeInbox(_ box: DesignInbox) async -> DesignInbox.Take {
        guard let (status, data) = await inboxCall(["op": "take", "id": box.id]) else {
            return .problem("Could not reach couch-tv Studio. Check the Apple TV is online, or type the code instead.")
        }
        return DesignInbox.readTake(status: status, data: data)
    }
}

struct InboxProblem: Error { let words: String }

/// The design store is asked once, at its own address: a redirect is refused (design-code.js redirect: "error").
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? { nil }
}
