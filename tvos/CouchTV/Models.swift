// What the home shows, as the bridge sends it. The bridge's JSON is read loosely (a field of an
// unexpected type is skipped, never a crash), so these are filled by hand from [String: Any].
import Foundation

struct Person: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct Weather: Codable, Equatable {
    var temp: Double
    var code: Int
    var isDay: Bool
    var text: String?
}

struct ContinueItem: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    var episodeTitle: String?
    var season: Int?
    var episode: Int?
    var appName: String?
    var appPackage: String?
    var poster: String?
    var progress: Double?

    var episodeLine: String {
        if let s = season, let e = episode { return "S\(s) E\(e)" }
        return episodeTitle ?? ""
    }
}

/// An app on the Apple TV. `id` is its bundle id; `package` names couch-tv's bundled logo when couch-tv
/// knows the app (the same names as the phone remote's logos).
struct DockApp: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    var package: String?
}

/// The few home settings the bridge can set (config.json home, and Home settings from the phone).
struct HomePrefs: Codable, Equatable {
    var clock24: Bool?
    var fahrenheit = false
    var sceneSeconds: Double = 20
    var sceneOrder: [String] = SceneLook.all.map(\.id)
    var keepWatching = true
    var dockMax = 10
}

enum JSON {
    /// A JSON number, but not true or false (Foundation keeps both as NSNumber).
    static func number(_ v: Any?) -> NSNumber? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n
    }

    static func string(_ v: Any?) -> String? {
        if let s = v as? String { return s }
        return number(v)?.stringValue
    }

    static func int(_ v: Any?) -> Int? {
        if let n = number(v) { return n.intValue }
        if let s = v as? String { return Int(s) }
        return nil
    }

    static func double(_ v: Any?) -> Double? {
        if let n = number(v) { return n.doubleValue }
        if let s = v as? String { return Double(s) }
        return nil
    }

    static func people(_ v: Any?) -> [Person] {
        (v as? [[String: Any]] ?? []).compactMap { p in
            guard let id = string(p["id"]), let name = string(p["name"]) else { return nil }
            return Person(id: id, name: name)
        }
    }

    static func items(_ v: Any?) -> [ContinueItem] {
        (v as? [[String: Any]] ?? []).compactMap { h in
            guard let id = string(h["id"]), let title = string(h["title"]) else { return nil }
            let app = h["app"] as? [String: Any]
            return ContinueItem(id: id, title: title, episodeTitle: string(h["episode_title"]),
                                season: int(h["season"]), episode: int(h["episode"]),
                                appName: string(app?["name"]), appPackage: string(app?["package"]),
                                poster: string(h["poster"]) ?? string(h["backdrop"]), progress: double(h["progress"]))
        }
    }

    static func apps(_ v: Any?) -> [DockApp] {
        (v as? [[String: Any]] ?? []).compactMap { a in
            guard let id = string(a["id"]), let title = string(a["title"]) else { return nil }
            return DockApp(id: id, title: title, package: string(a["package"]))
        }
    }

    static func weather(_ j: [String: Any]) -> Weather? {
        guard let t = double(j["temp"]) else { return nil }
        return Weather(temp: t, code: int(j["code"]) ?? 0, isDay: (j["is_day"] as? Bool) ?? true, text: string(j["text"]))
    }

    /// config.json's home section, then Home settings from the phone on top of it.
    static func prefs(home: [String: Any]?, settings: [String: Any]?, into p: inout HomePrefs) {
        for src in [home, settings].compactMap({ $0 }) {
            if let c = string(src["clock"]) { p.clock24 = c == "24h" ? true : (c == "12h" ? false : p.clock24) }
            if let u = string(src["wx_unit"]) { p.fahrenheit = u == "f" }
            if let s = double(src["scene_seconds"]) { p.sceneSeconds = max(5, s) }
            if let k = src["keep_watching"] as? Bool { p.keepWatching = k }
            if let d = int(src["dock_size"]) { p.dockMax = min(10, max(1, d)) }
            let order = (src["scene_order"] ?? src["scenes"]) as? [Any]
            if let order {
                let off = Set((src["scenes_off"] as? [Any] ?? []).compactMap(string))
                let known = Set(SceneLook.all.map(\.id))
                let ids = order.compactMap(string).filter { known.contains($0) && !off.contains($0) }
                if !ids.isEmpty { p.sceneOrder = ids }
            }
        }
    }
}

// MARK: - kids mode (docs/APPLE-TV.md, "Kids mode")

/// One show on a kids profile's shelf. The app never holds a link: the bridge opens the show by its id.
struct KidsShow: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    var season: Int?
    var episode: Int?
    var poster: String?
    var appName: String?
    var appPackage: String?      // names couch-tv's bundled logo
    var appBundle: String?       // the show's app on this Apple TV, when it has it

    var subtitle: String {
        if let s = season, let e = episode { return "Season \(s), episode \(e)" }
        if let s = season { return "Season \(s)" }
        return appName ?? ""
    }
}

/// A kids profile's home, as /api/appletv/kids sends it: the shelf, the apps they may open, and the parent
/// PIN's salted hash (never the PIN). Kept with the cache, so kids mode stays on with the bridge away.
struct KidsShelf: Codable, Equatable {
    let who: String
    var name: String
    var shows: [KidsShow]
    var apps: [DockApp]
    var pinHash: String
    var pinSalt: String
    var pinRounds: Int
    var grownUps: [String]
}

extension JSON {
    /// nil for anyone who is not a kids profile, or an answer without a PIN hash.
    static func kids(_ j: [String: Any]) -> KidsShelf? {
        guard (j["kids"] as? Bool) == true, let who = string(j["who"]),
              let hash = string(j["pin_hash"]), hash.count == 64, let salt = string(j["pin_salt"]), !salt.isEmpty else { return nil }
        let shows: [KidsShow] = (j["shows"] as? [[String: Any]] ?? []).compactMap { s in
            guard let id = string(s["id"]), let title = string(s["title"]) else { return nil }
            let app = s["app"] as? [String: Any]
            return KidsShow(id: id, title: title, season: int(s["season"]), episode: int(s["episode"]),
                            poster: string(s["poster"]) ?? string(s["backdrop"]), appName: string(app?["name"]),
                            appPackage: string(app?["package"]), appBundle: string(app?["bundle"]))
        }
        return KidsShelf(who: who, name: string(j["name"]) ?? who, shows: shows, apps: apps(j["apps"]),
                         pinHash: hash.lowercased(), pinSalt: salt, pinRounds: max(1, int(j["pin_rounds"]) ?? 4000),
                         grownUps: (j["grown_ups"] as? [Any] ?? []).compactMap(string))
    }
}
