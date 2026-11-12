// Everything the home shows, kept fresh from the bridge. Without the bridge (not set up, or the computer
// is off) the clock, the date and the scenes still work, and the apps last seen stay in the dock.
import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

enum BridgeState: Equatable {
    case notSet
    case connecting
    case connected
    case needsCode(String)          // found, but it has a pairing key: type the code in Settings
    case down(String)
}

@MainActor
final class HomeModel: ObservableObject {
    @Published var people: [Person] = []
    @Published var who = ""
    @Published var weather: Weather?
    @Published var items: [ContinueItem] = []
    @Published var apps: [DockApp] = []
    @Published var dockLine = 10
    @Published var prefs = HomePrefs()
    @Published var localClock24: Bool? = UserDefaults.standard.object(forKey: "clock24") as? Bool
    @Published var state: BridgeState = .notSet
    @Published var found: [FoundBridge] = []
    @Published var sleepEnds: Date?
    @Published var message = ""
    @Published var sceneIndex = 0
    @Published var showSettings = false
    @Published var showMore = false
    @Published var posters: [String: PlatformImage] = [:]     // Keep watching pictures, by card id
    @Published var kids: KidsShelf?                           // the person watching is a kids profile
    @Published var kidsUnlockedFor: String?                   // a kids profile a grown up unlocked, with nobody to move to
    @Published var pin: PinPad?                               // the parent PIN pad, while it is open
    @Published var kidPosters: [String: PlatformImage] = [:]  // shelf pictures, by show id
    private var wrongs: [Date] = []

    let bridge: BridgeClient
    private let finder = BridgeFinder()
    private var loop: Task<Void, Never>?
    private var turner: Task<Void, Never>?
    private var messageTask: Task<Void, Never>?
    private var ticks = 0

    init(link: BridgeLink? = Keychain.load(), offline: Bool = false) {
        bridge = BridgeClient(link: link)
        state = link == nil ? .notSet : .connecting
        restoreCache()
        if offline { return }
        finder.onChange = { [weak self] found in
            guard let self else { return }
            self.found = found
            if self.bridge.link == nil, found.count == 1 { Task { await self.tryFound(found[0]) } }
        }
        finder.start()
    }

    // MARK: what the views ask

    var clock24: Bool { prefs.clock24 ?? localClock24 ?? false }

    var scenes: [SceneLook] { prefs.sceneOrder.map(SceneLook.byId) }

    var look: SceneLook { let s = scenes; return s[sceneIndex % max(1, s.count)] }

    var dockApps: [DockApp] { Array(apps.prefix(min(dockLine, prefs.dockMax))) }

    var connected: Bool { state == .connected }

    /// Kids mode is showing: the person watching is a kids profile, and no grown up has unlocked it.
    var kidsOn: Bool { kids.map { $0.who == who && kidsUnlockedFor != who } ?? false }

    func timeText(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        let h = c.hour ?? 0, m = c.minute ?? 0
        let hh = clock24 ? String(format: "%02d", h) : String(h % 12 == 0 ? 12 : h % 12)
        return "\(hh):" + String(format: "%02d", m)
    }

    func dateText(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_AU")
        f.setLocalizedDateFormatFromTemplate("EEEEdMMMM")
        return f.string(from: d).replacingOccurrences(of: ",", with: "")
    }

    func tempText(_ w: Weather) -> String {
        prefs.fahrenheit ? "\(Int((w.temp * 9 / 5 + 32).rounded()))°F" : "\(Int(w.temp.rounded()))°"
    }

    static func weatherWords(_ code: Int) -> String {
        switch code {
        case 0: return "Clear"
        case 1, 2: return "Partly cloudy"
        case 3: return "Cloudy"
        case 45, 48: return "Fog"
        case 51...57: return "Drizzle"
        case 61...67, 80...82: return "Rain"
        case 71...77, 85, 86: return "Snow"
        case 95...99: return "Storm"
        default: return ""
        }
    }

    static func weatherSymbol(_ w: Weather) -> String {
        if w.code >= 95 { return "cloud.bolt" }
        if w.code >= 51 { return "cloud.rain" }
        if w.code >= 3 || w.code == 45 || w.code == 48 { return "cloud" }
        return w.isDay ? "sun.max" : "moon"
    }

    // MARK: running

    func start() {
        if loop == nil {
            loop = Task { [weak self] in
                while !Task.isCancelled {
                    await self?.refresh()
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                }
            }
        }
        restartTurner()
    }

    func restartTurner() {
        turner?.cancel()
        turner = Task { [weak self] in
            while !Task.isCancelled {
                let secs = self?.prefs.sceneSeconds ?? 20
                try? await Task.sleep(nanoseconds: UInt64(secs * 1_000_000_000))
                guard let self, !Task.isCancelled, self.scenes.count > 1 else { continue }
                withAnimation(.easeInOut(duration: 1.6)) { self.sceneIndex = (self.sceneIndex + 1) % self.scenes.count }
            }
        }
    }

    func say(_ text: String, for seconds: Double = 5) {
        message = text
        messageTask?.cancel()
        messageTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            if !Task.isCancelled { self?.message = "" }
        }
    }

    func refresh() async {
        guard bridge.link != nil else { return }
        ticks += 1
        do {
            if ticks == 1 || ticks % 10 == 0 || state != .connected {
                let hello = try await bridge.get("/api/appletv/hello")
                if var l = bridge.link, let tv = JSON.string(hello["tv"]), l.tv != tv {
                    l.tv = tv
                    l.name = JSON.string(hello["name"])
                    bridge.link = l
                    Keychain.save(l)
                }
                var p = prefs
                let cfg = try? await bridge.get("/api/config")
                let st = try? await bridge.get("/api/settings")
                JSON.prefs(home: cfg?["home"] as? [String: Any], settings: st?["settings"] as? [String: Any], into: &p)
                if p != prefs {
                    let turn = p.sceneSeconds != prefs.sceneSeconds
                    prefs = p
                    if sceneIndex >= scenes.count { sceneIndex = 0 }
                    if turn { restartTurner() }
                }
                people = JSON.people((try? await bridge.get("/api/people"))?["people"])
            }
            state = .connected
            if let w = try? await bridge.get("/api/who"), let id = JSON.string(w["who"]) { who = id }
            await refreshKids()
            if ticks == 1 || ticks % 20 == 0 || weather == nil, let w = try? await bridge.get("/api/weather") {
                weather = JSON.weather(w)
            }
            if kidsOn {
                items = []          // no Keep watching in kids mode, theirs or anyone's
            } else if prefs.keepWatching {
                items = JSON.items((try? await bridge.get("/api/continue", who.isEmpty ? [:] : ["who": who]))?["items"])
                await loadPosters()
            } else {
                items = []
            }
            if let s = try? await bridge.get("/api/sleep") { sleepEnds = JSON.string(s["ends"]).flatMap(Self.isoDate) }
            if let a = try? await bridge.get("/api/appletv/apps") {
                let list = JSON.apps(a["apps"])
                if !list.isEmpty { apps = list }
                dockLine = JSON.int(a["line"]) ?? prefs.dockMax
            }
            saveCache()
        } catch let e as BridgeError where e.status == 401 {
            state = .needsCode("The bridge wants its pairing key again. Open Settings and type a new code.")
        } catch {
            state = .down("The couch-tv bridge is not answering. The clock and scenes still work.")
            items = []
        }
    }

    /// Keep watching pictures, fetched once each and kept, so a card never waits for its picture.
    func loadPosters() async {
        for item in items where posters[item.id] == nil {
            guard let u = bridge.picture(item.poster), let d = try? await bridge.data(u),
                  let img = PlatformImage(data: d) else { continue }
            posters[item.id] = img
        }
        if posters.count > 40 {
            let keep = Set(items.map(\.id))
            posters = posters.filter { keep.contains($0.key) }
        }
    }

    static func isoDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    // MARK: actions

    func open(_ app: DockApp) {
        if kidsOn, !(kids?.apps.contains { $0.id == app.id } ?? false) {
            say("Ask a grown up for that one.")
            return
        }
        #if canImport(UIKit)
        if let u = URLSchemes.url(for: app.id), UIApplication.shared.canOpenURL(u) {
            UIApplication.shared.open(u)
            return
        }
        #endif
        guard bridge.link != nil else {
            say("Couch TV needs the couch-tv bridge to open \(app.title). Settings has the steps.")
            return
        }
        say("Opening \(app.title)…", for: 3)
        Task {
            do {
                _ = try await bridge.post("/api/appletv/open", ["bundle": app.id])
            } catch {
                say("\(app.title) did not open: \(error.localizedDescription)")
            }
        }
    }

    func resume(_ item: ContinueItem) {
        say("Opening \(item.title)…", for: 3)
        Task {
            do {
                var body: [String: Any] = ["id": item.id]
                if !who.isEmpty { body["who"] = who }
                _ = try await bridge.post("/api/continue/open", body)
                say("\(item.appName ?? "The app") opens on its own page: pick \(item.title) there.", for: 6)
            } catch {
                say("\(item.title) did not open: \(error.localizedDescription)")
            }
        }
    }

    func choose(_ person: Person) {
        if kidsOn { openPin(); return }      // leaving a kids profile: the parent PIN first
        who = person.id
        Task {
            _ = try? await bridge.post("/api/who", ["who": person.id])
            await refreshKids()
            items = kidsOn ? [] : JSON.items((try? await bridge.get("/api/continue", ["who": person.id]))?["items"])
            await loadPosters()
        }
    }

    func openSettings() {
        if kidsOn { openPin() } else { showSettings = true }
    }

    func openMore() {
        if kidsOn { openPin() } else { showMore = true }
    }

    // MARK: kids mode (docs/APPLE-TV.md, "Kids mode")

    /// Is the person watching a kids profile: their shelf, their apps and the PIN's hash, from the bridge. With the
    /// bridge away it stays as it was (kept with the cache too), so a restart without the bridge stays locked.
    func refreshKids() async {
        if !who.isEmpty {
            do {
                kids = JSON.kids(try await bridge.get("/api/appletv/kids", ["who": who]))
            } catch let e as BridgeError where e.status == 404 || e.status == 400 {
                kids = nil          // a bridge from before kids mode on the Apple TV
            } catch {}
        }
        if let u = kidsUnlockedFor, u != who { kidsUnlockedFor = nil }
        if kidsOn {
            showSettings = false
            showMore = false
            await loadKidPosters()
        } else {
            pin = nil
        }
    }

    func loadKidPosters() async {
        for s in kids?.shows ?? [] where kidPosters[s.id] == nil {
            guard let u = bridge.picture(s.poster), let d = try? await bridge.data(u), let img = PlatformImage(data: d) else { continue }
            kidPosters[s.id] = img
        }
    }

    /// A show from the shelf: the bridge opens it (into the show where the app takes a link, else its app).
    func openShow(_ s: KidsShow) {
        say("Opening \(s.title)…", for: 3)
        Task {
            do {
                let r = try await bridge.post("/api/appletv/kids/open", ["who": who, "id": s.id])
                say(JSON.string(r["note"]) ?? "", for: 6)
            } catch {
                #if canImport(UIKit)
                // the bridge away: at least the show's app, where it has a public address
                if let b = s.appBundle, let u = URLSchemes.url(for: b), UIApplication.shared.canOpenURL(u) {
                    _ = await UIApplication.shared.open(u)
                    say("\(s.appName ?? "The app") is open. Pick \(s.title) there.", for: 6)
                    return
                }
                #endif
                say("\(s.title) did not open. Ask a grown up.")
            }
        }
    }

    /// Seconds left before the pad takes another try (five wrong PINs in a minute), else 0.
    var pinWait: Int {
        let now = Date()
        let recent = wrongs.filter { now.timeIntervalSince($0) < KidsPIN.wait }
        guard recent.count >= KidsPIN.tries, let first = recent.first else { return 0 }
        return max(1, Int((KidsPIN.wait - now.timeIntervalSince(first)).rounded(.up)))
    }

    func openPin() {
        guard kidsOn else { return }
        pin = PinPad()
    }

    func closePin() { pin = nil }

    /// A key on the pad: a digit, "del" or "ok". The right PIN unlocks as soon as it is typed.
    func pinKey(_ k: String) {
        guard var p = pin, let shelf = kids else { return }
        wrongs = wrongs.filter { Date().timeIntervalSince($0) < KidsPIN.wait }
        if pinWait > 0 { p.message = ""; pin = p; return }
        switch k {
        case "del":
            if !p.digits.isEmpty { p.digits.removeLast() }
            p.message = ""
        case "ok":
            if KidsPIN.matches(p.digits, shelf) { unlock(p.digits); return }
            guard !p.digits.isEmpty else { return }
            wrongs.append(Date())
            p.digits = ""
            p.message = "That PIN is not right."
            p.wrong += 1
        default:
            guard k.count == 1, k.allSatisfy(\.isNumber), p.digits.count < KidsPIN.longest else { return }
            p.digits += k
            p.message = ""
            if KidsPIN.matches(p.digits, shelf) { unlock(p.digits); return }
        }
        pin = p
    }

    /// The right PIN: the Apple TV moves to the first grown up, and the bridge checks the PIN again. With nobody
    /// to move to, or the bridge away, kids mode stays off on this profile until someone else is picked.
    private func unlock(_ code: String) {
        guard let shelf = kids else { return }
        pin = nil
        wrongs = []
        let grown = people.first { shelf.grownUps.contains($0.id) }?.id ?? shelf.grownUps.first
        guard let g = grown else { kidsUnlockedFor = shelf.who; return }
        Task {
            do {
                _ = try await bridge.post("/api/who", ["who": g, "pin": code])
                who = g
                kids = nil
                items = prefs.keepWatching ? JSON.items((try? await bridge.get("/api/continue", ["who": g]))?["items"]) : []
                await loadPosters()
            } catch let e as BridgeError where e.status == 403 || e.status == 429 {
                say(e.message)
                await refreshKids()         // the PIN was changed on the phone: the new hash
            } catch {
                kidsUnlockedFor = shelf.who
                say("Kids mode is off until someone else is picked. The bridge is not answering.", for: 8)
            }
        }
    }

    static let sleepSteps: [Double] = [15, 30, 60, 90, 0]

    func nextSleep() {
        let left = sleepEnds.map { $0.timeIntervalSinceNow / 60 } ?? 0
        let next = left <= 0 ? 15 : (Self.sleepSteps.first { $0 > left + 1 } ?? 0)
        Task {
            do {
                let r = try await bridge.post("/api/sleep", ["minutes": next])
                sleepEnds = JSON.string(r["ends"]).flatMap(Self.isoDate)
                say(next == 0 ? "Sleep timer off" : "The Apple TV sleeps in \(Int(next)) minutes", for: 3)
            } catch {
                say("The sleep timer needs the bridge: \(error.localizedDescription)")
            }
        }
    }

    // MARK: settings

    func setLocalClock(_ on24: Bool) {
        localClock24 = on24
        UserDefaults.standard.set(on24, forKey: "clock24")
    }

    /// Connect to a bridge: `secret` is the six digit code from scripts/appletv-home-code.py, or the
    /// pairing key itself, or empty for a bridge with no key. Returns what went wrong, or nil.
    func connect(address: String, secret: String) async -> String? {
        guard let url = BridgeClient.normalise(address) else { return "That address does not look right. Try 192.0.2.20:5400." }
        let s = secret.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: " ", with: "")
        var link = BridgeLink(url: url, key: "", tv: nil, name: nil)
        do {
            if s.count == 6, s.allSatisfy(\.isNumber) {
                let r = try await bridge.post("/api/appletv/claim", ["code": s], link: link)
                link.key = JSON.string(r["key"]) ?? ""
                link.tv = JSON.string(r["tv"])
            } else {
                link.key = s
            }
            let hello = try await bridge.get("/api/appletv/hello", link: link)
            link.tv = JSON.string(hello["tv"]) ?? link.tv
            link.name = JSON.string(hello["name"])
        } catch let e as BridgeError {
            if e.status == 401 { return s.isEmpty ? Self.keyNeeded + " Type the six digit code, or the key." : e.message }
            return e.message
        } catch {
            return "No couch-tv bridge answered at \(url). Is the computer on, and the bridge running?"
        }
        bridge.link = link
        Keychain.save(link)
        state = .connecting
        ticks = 0
        await refresh()
        return nil
    }

    static let keyNeeded = "This bridge has a pairing key."

    func forget() {
        bridge.link = nil
        Keychain.save(nil)
        state = .notSet
        items = []
        people = []
        weather = nil
    }

    private func tryFound(_ f: FoundBridge) async {
        if let why = await connect(address: f.url, secret: ""), why.hasPrefix(Self.keyNeeded) {
            state = .needsCode("Found the couch-tv bridge. It has a pairing key: open Settings and type the code.")
        }
    }

    // MARK: the copy kept for when the bridge is away

    private struct Cache: Codable {
        var apps: [DockApp]
        var people: [Person]
        var who: String
        var prefs: HomePrefs
        var dockLine: Int
        var kids: KidsShelf?
    }

    private func saveCache() {
        let c = Cache(apps: apps, people: people, who: who, prefs: prefs, dockLine: dockLine, kids: kids)
        if let d = try? JSONEncoder().encode(c) { UserDefaults.standard.set(d, forKey: "home-cache") }
    }

    private func restoreCache() {
        guard let d = UserDefaults.standard.data(forKey: "home-cache"), let c = try? JSONDecoder().decode(Cache.self, from: d) else { return }
        apps = c.apps
        people = c.people
        who = c.who
        prefs = c.prefs
        dockLine = c.dockLine
        kids = c.kids
    }
}

/// Apps whose public address opens them straight from the Apple TV, without the bridge. Only used when
/// tvOS says the app is there (canOpenURL, with the scheme listed in Info.plist).
enum URLSchemes {
    static let table: [String: String] = [
        "com.google.ios.youtube": "youtube://",
        "com.netflix.Netflix": "nflx://",
        "com.spotify.client": "spotify://",
    ]

    static func url(for bundle: String) -> URL? { table[bundle].flatMap(URL.init(string:)) }
}
