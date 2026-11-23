// A couch-tv Studio design, read for the Apple TV. A design is untrusted input: this file is the same gate
// as the TV home's (tv-home/web/design.js, sanitize), rebuilt in Swift. Only listed keys are read, numbers
// are clamped, choices come from fixed lists, colours are #hex or rgb() only, words drawn on the screen are
// Latin letters and a little punctuation with no digits, and pictures are a JPEG, PNG or WebP inside the
// design or one of couch-tv's own backgrounds. Unknown keys are ignored and nothing here can crash on bad
// input. Getting a design by code (tv-home/web/design-code.js) is here too. No UI in this file, so the
// checker in tests/test_appletv_design.py compiles it on its own.
import Foundation

// MARK: - the gate's checks (design.js SAN)

enum DesignGate {
    /// SAN.n: a number (a number, a numeric string, true or false, null as 0, like JavaScript's Number()),
    /// clamped to lo...hi; whole numbers rounded, others kept to three decimals. nil when not a number.
    static func num(_ v: Any?, _ lo: Double, _ hi: Double, int: Bool = false) -> Double? {
        guard let v else { return nil }
        var d: Double?
        if v is NSNull {
            d = 0
        } else if let n = v as? NSNumber {
            d = CFGetTypeID(n) == CFBooleanGetTypeID() ? (n.boolValue ? 1 : 0) : n.doubleValue
        } else if let s = v as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            d = t.isEmpty ? 0 : Double(t)
        }
        guard var x = d, x.isFinite else { return nil }
        x = Swift.max(lo, Swift.min(hi, x))
        return int ? (x + 0.5).rounded(.down) : (x * 1000).rounded() / 1000
    }

    static func int(_ v: Any?, _ lo: Int, _ hi: Int) -> Int? {
        num(v, Double(lo), Double(hi), int: true).map { Int($0) }
    }

    static func pick(_ v: Any?, _ choices: [String]) -> String? {
        guard let s = v as? String, choices.contains(s) else { return nil }
        return s
    }

    static func bool(_ v: Any?) -> Bool? {
        guard let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }

    static func dict(_ v: Any?) -> [String: Any] { v as? [String: Any] ?? [:] }

    static func list(_ v: Any?) -> [Any] { v as? [Any] ?? [] }

    private static func matches(_ s: String, _ pattern: String, _ options: NSRegularExpression.Options = []) -> Bool {
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return false }
        return re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    /// A plain colour: #hex (3 to 8 digits) or rgb()/rgba() with numbers only. Anything else is dropped.
    static func colour(_ v: Any?) -> String? {
        guard let raw = v as? String else { return nil }
        let c = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if matches(c, "^#[0-9a-f]{3,8}$", .caseInsensitive) || matches(c, "^rgba?\\(\\s*[\\d.\\s,%]+\\)$", .caseInsensitive) { return c }
        return nil
    }

    /// The characters a TV draws in words (design.js WORD_OK).
    static let wordOK = "^[A-Za-z\u{00C0}-\u{00D6}\u{00D8}-\u{00F6}\u{00F8}-\u{017F} .,'\u{2019}!?&():;\"-]*$"

    /// SAN.w: words drawn on the screen, line by line. A line with a digit or any character outside the list
    /// is dropped whole. nil when not a string; "" when nothing is left.
    static func words(_ v: Any?, _ max: Int) -> String? {
        guard let s = v as? String else { return nil }
        let t = s.precomposedStringWithCompatibilityMapping.replacingOccurrences(of: "\t", with: " ")
        let lines = t.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n").map { line -> String in
            var l = line
            while l.contains("  ") { l = l.replacingOccurrences(of: "  ", with: " ") }
            return l.trimmingCharacters(in: CharacterSet(charactersIn: " "))
        }
        var out = lines.filter { matches($0, wordOK) }.joined(separator: "\n")
        while out.contains("\n\n\n") { out = out.replacingOccurrences(of: "\n\n\n", with: "\n\n") }
        out = out.trimmingCharacters(in: CharacterSet(charactersIn: " \n"))
        if webAddress(out) { return "" }
        return String(out.prefix(max))
    }

    /// Words that name a web address ("evil.com", "evil dot com") are not drawn on a TV (design.js scam).
    static func webAddress(_ s: String) -> Bool {
        matches(s, "[a-z0-9-]{2,}(\\.|\\s+dot\\s+|\\(\\.\\)|\\[\\.\\])(com|net|org|au|io|co|uk|nz|info|biz|xyz|app|dev|tv|me|ly|site|online|shop|link)\\b",
                .caseInsensitive)
    }

    static let poison = ["__proto__", "constructor", "prototype"]

    /// A key or a token: a part between dots or colons that is very long, or long with capitals, small
    /// letters and digits mixed, or a JWT.
    static func secretish(_ p: String) -> Bool {
        p.split(whereSeparator: { $0 == "." || $0 == ":" }).map(String.init).contains { s in
            if s.count >= 32 { return true }
            if s.count >= 16, s.rangeOfCharacter(from: .lowercaseLetters) != nil,
               s.rangeOfCharacter(from: .uppercaseLetters) != nil, s.rangeOfCharacter(from: .decimalDigits) != nil { return true }
            return s.hasPrefix("eyJ") && s.count >= 12
        }
    }

    static func pkgOk(_ v: Any?) -> String? {
        guard let p = v as? String, matches(p, "^[A-Za-z0-9_.:-]{1,200}$"), !poison.contains(p), !secretish(p) else { return nil }
        return p
    }

    static func idOk(_ v: Any?) -> String? {
        guard let p = v as? String, matches(p, "^[A-Za-z0-9_-]{1,60}$"), !poison.contains(p), !secretish(p) else { return nil }
        return p
    }

    /// A picture: a JPEG, PNG or WebP inside the design (base64), or one of couch-tv's own backgrounds.
    /// Never a link.
    static func image(_ v: Any?) -> String? {
        guard let u = v as? String, u.utf8.count <= 4_000_000 else { return nil }
        if u.hasPrefix("data:image/"), matches(u, "^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$") { return u }
        if matches(u, "^backgrounds/[A-Za-z0-9_][A-Za-z0-9_./-]*\\.(jpe?g|png|webp)$", .caseInsensitive),
           !u.contains(".."), !u.contains("//") { return u }
        return nil
    }

    static func timeZone(_ v: Any?) -> String? {
        guard let s = v as? String, matches(s, "^[A-Z][A-Za-z_]{1,30}(/[A-Z][A-Za-z_-]{1,30}){1,2}$") else { return nil }
        return s
    }
}

// MARK: - colours

/// A design colour as numbers, 0 to 1. Only from a colour the gate let in.
struct DesignRGBA: Equatable, Codable {
    var r: Double, g: Double, b: Double, a: Double

    static func parse(_ s: String?) -> DesignRGBA? {
        guard let s = DesignGate.colour(s) else { return nil }
        if s.hasPrefix("#") {
            let hex = Array(s.dropFirst().lowercased())
            func v(_ i: Int, _ n: Int) -> Double {
                let str = String(hex[i..<(i + n)])
                let x = Double(Int(str, radix: 16) ?? 0)
                return n == 1 ? x * 17 / 255 : x / 255
            }
            switch hex.count {
            case 3: return DesignRGBA(r: v(0, 1), g: v(1, 1), b: v(2, 1), a: 1)
            case 4: return DesignRGBA(r: v(0, 1), g: v(1, 1), b: v(2, 1), a: v(3, 1))
            case 6: return DesignRGBA(r: v(0, 2), g: v(2, 2), b: v(4, 2), a: 1)
            case 8: return DesignRGBA(r: v(0, 2), g: v(2, 2), b: v(4, 2), a: v(6, 2))
            default: return nil
            }
        }
        guard let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")") else { return nil }
        let parts = s[s.index(after: open)..<close].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 3 || parts.count == 4 else { return nil }
        func channel(_ p: String, alpha: Bool) -> Double? {
            if p.hasSuffix("%") { return Double(p.dropLast()).map { Swift.max(0, Swift.min(1, $0 / 100)) } }
            guard let d = Double(p) else { return nil }
            return Swift.max(0, Swift.min(1, alpha ? d : d / 255))
        }
        guard let r = channel(parts[0], alpha: false), let g = channel(parts[1], alpha: false),
              let b = channel(parts[2], alpha: false) else { return nil }
        let a = parts.count == 4 ? channel(parts[3], alpha: true) : 1
        guard let a else { return nil }
        return DesignRGBA(r: r, g: g, b: b, a: a)
    }
}

// MARK: - the design

/// Where a part sits, in pixels of a 1920x1080 screen.
struct DesignPlace: Equatable {
    var x: Double = 0
    var y: Double = 0
    var scale: Double = 1
    var rotate: Double = 0
    var opacity: Double = 1
    var hidden = false

    static func read(_ s: [String: Any]) -> DesignPlace {
        DesignPlace(x: DesignGate.num(s["x"], -3840, 3840) ?? 0, y: DesignGate.num(s["y"], -2160, 2160) ?? 0,
                    scale: DesignGate.num(s["scale"], 0.1, 8) ?? 1, rotate: DesignGate.num(s["rotate"], -180, 180) ?? 0,
                    opacity: DesignGate.num(s["opacity"], 0.05, 1) ?? 1, hidden: DesignGate.bool(s["hidden"]) ?? false)
    }
}

/// How words look (design.js sanType).
struct DesignType: Equatable {
    static let fonts = ["inter", "antonio", "serif", "mono", "condensed"]
    var font: String?
    var weight: Int?
    var colour: String?
    var shadow: String?
    var shade: String?
    var upper = false
    var align: String?

    static func read(_ s: [String: Any]) -> DesignType {
        DesignType(font: DesignGate.pick(s["font"], fonts), weight: DesignGate.int(s["weight"], 100, 900),
                   colour: DesignGate.colour(s["colour"]), shadow: DesignGate.pick(s["shadow"], ["none", "soft", "strong"]),
                   shade: DesignGate.pick(s["shade"], ["glow", "panel"]), upper: DesignGate.pick(s["case"], ["upper"]) != nil,
                   align: DesignGate.pick(s["align"], ["left", "center", "right"]))
    }
}

/// One of the home's own parts: clock, date, weather, people, quick, keep_watching, dock.
struct DesignPart: Equatable {
    var place = DesignPlace()
    var type = DesignType()
    var format: String?          // clock 12h/24h, date short/numeric/weekday/day_month/full
    var style: String?           // clock glass/solid
    var at: String?              // clock "scene": where each built in scene puts it (behind the hills, on the water)
    var behind: Bool?            // clock behind the hills of a built in scene
    var panel: String?
    var placeName: Bool?
    var words: Bool?
    var layout: String?          // dock row/column/grid
    var columns: Int?
    var iconSize: Double?
    var iconGap: Double?
    var labels: String?
    var iconShape: String?
    var maxApps: Int?

    static let keys = ["clock", "date", "weather", "people", "quick", "keep_watching", "dock"]
    static let limit: [String: Double] = ["clock": 3, "date": 4, "weather": 4, "people": 3, "quick": 3, "keep_watching": 1.5]

    static func read(_ key: String, _ s: [String: Any]) -> DesignPart {
        var p = DesignPart(place: .read(s))
        if ["clock", "date", "weather", "keep_watching"].contains(key) { p.type = .read(s) }
        if key == "clock" {
            p.format = DesignGate.pick(s["format"], ["12h", "24h"])
            p.style = DesignGate.pick(s["style"], ["glass", "solid"])
            p.at = DesignGate.pick(s["at"], ["scene"])
            p.behind = DesignGate.bool(s["behind"])
        }
        if key == "date" { p.format = DesignGate.pick(s["format"], DesignDates.keys) }
        if key == "weather" { p.placeName = DesignGate.bool(s["place"]); p.words = DesignGate.bool(s["words"]) }
        if ["people", "quick", "keep_watching", "dock"].contains(key) { p.panel = DesignGate.pick(s["panel"], ["glass", "solid", "none"]) }
        if key == "dock" {
            p.layout = DesignGate.pick(s["layout"], ["row", "column", "grid"])
            p.columns = DesignGate.int(s["columns"], 1, 12)
            p.iconSize = DesignGate.num(s["icon_size"], 40, 240)
            p.iconGap = DesignGate.num(s["icon_gap"], 0, 120)
            p.labels = DesignGate.pick(s["labels"], ["focus", "always", "off"])
            p.iconShape = DesignGate.pick(s["icon_shape"], ["rounded", "square", "circle", "squircle", "none"])
            p.maxApps = DesignGate.int(s["max_apps"], 1, 10)
            // the dock can be made small or faint, never gone
            p.place.scale = Swift.max(0.5, p.place.scale)
            p.place.opacity = Swift.max(0.4, p.place.opacity)
        }
        if let cap = limit[key] { p.place.scale = Swift.min(cap, p.place.scale) }
        return p
    }
}

struct DesignBackground: Equatable {
    var image: String?
    var darken: Double = 0
    var zoom: Double = 1
    var x: Double = 50
    var y: Double = 50
    var blur: Double = 0
    var scrim: String?
    var colour: String?
    var colour2: String?
    var angle: Double = 180
    var radial = false

    static func read(_ s: [String: Any]) -> DesignBackground? {
        if let img = DesignGate.image(s["image"]) {
            return DesignBackground(image: img, darken: DesignGate.num(s["darken"], 0, 0.9) ?? 0,
                                    zoom: DesignGate.num(s["zoom"], 1, 4) ?? 1, x: DesignGate.num(s["x"], 0, 100) ?? 50,
                                    y: DesignGate.num(s["y"], 0, 100) ?? 50, blur: DesignGate.num(s["blur"], 0, 16) ?? 0,
                                    scrim: DesignGate.pick(s["scrim"], ["top", "bottom", "left", "right", "even"]))
        }
        guard let c = DesignGate.colour(s["colour"]) else { return nil }
        var b = DesignBackground(colour: c)
        if let c2 = DesignGate.colour(s["colour2"]) {
            b.colour2 = c2
            b.angle = DesignGate.num(s["angle"], 0, 360, int: true) ?? 180
            b.radial = DesignGate.bool(s["radial"]) ?? false
        }
        return b
    }
}

/// The widgets' shared look (design.look): plain colours only.
struct DesignLook: Equatable {
    var ink: String?, sub: String?, panel: String?, rim: String?, solid: String?, paper: String?, accent: String?, focus: String?

    static func read(_ s: [String: Any]) -> DesignLook {
        DesignLook(ink: DesignGate.colour(s["ink"]), sub: DesignGate.colour(s["sub"]), panel: DesignGate.colour(s["panel"]),
                   rim: DesignGate.colour(s["rim"]), solid: DesignGate.colour(s["solid"]), paper: DesignGate.colour(s["paper"]),
                   accent: DesignGate.colour(s["accent"]), focus: DesignGate.colour(s["focus"]))
    }
}

/// A widget's look (design.js WSTYLE).
struct DesignWidgetStyle: Equatable {
    var panel: String?
    var ink: String?
    var corners: String?
    var shadow: String?
    var colour: String?
    var accent: String?
    var opacity: Double?
    var gradient: String?

    static func read(_ s: [String: Any]) -> DesignWidgetStyle {
        DesignWidgetStyle(panel: DesignGate.pick(s["panel"], ["glass", "solid", "colour", "paper", "none"]),
                          ink: DesignGate.pick(s["ink"], ["auto", "white", "ink", "accent"]),
                          corners: DesignGate.pick(s["corners"], ["square", "soft", "round", "pill"]),
                          shadow: DesignGate.pick(s["shadow"], ["none", "soft", "lifted"]),
                          colour: DesignGate.colour(s["colour"]), accent: DesignGate.colour(s["accent"]),
                          opacity: DesignGate.num(s["opacity"], 0.2, 1), gradient: DesignGate.pick(s["gradient"], ["off", "soft"]))
    }
}

/// A widget's options, each checked as design.js OPT does. Only the options its kind takes (WOPT) are read.
struct DesignWidgetOpts: Equatable {
    var label: String?, text: String?, sub: String?, kicker: String?, caption: String?
    var format: String?, ampm: Bool?, seconds: Bool?, date: Bool?, align: String?
    var show: String?, dfmt: String?, cities: [String] = []
    var month: Int?, day: Int?, unit: String?, icon: String?
    var apps: [String] = [], cols: Int?, names: Bool?, more: Bool?
    var image: String?, fit: String?, mat: String?, place: Bool?, hilo: Bool?
    var quick: [String] = [], count: Int?, shows: Int?

    static let quickIds = ["sleep", "picture", "look", "soundscape", "screen_off", "headphones", "input", "bluetooth", "network", "tvsettings", "screensaver"]

    static func read(_ kind: String, _ s: [String: Any]) -> DesignWidgetOpts {
        var o = DesignWidgetOpts()
        let want = Set((DesignWidgets.options[kind] ?? "").split(separator: " ").map(String.init))
        func has(_ k: String) -> Bool { want.contains(k) && s[k] != nil }
        if has("label") { o.label = DesignGate.words(s["label"], 40) }
        if has("text") { o.text = DesignGate.words(s["text"], 120) }
        if has("sub") { o.sub = DesignGate.words(s["sub"], 80) }
        if has("kicker") { o.kicker = DesignGate.words(s["kicker"], 60) }
        if has("caption") { o.caption = DesignGate.words(s["caption"], 60) }
        if has("format") { o.format = DesignGate.pick(s["format"], ["12h", "24h"]) }
        if has("ampm") { o.ampm = DesignGate.bool(s["ampm"]) }
        if has("seconds") { o.seconds = DesignGate.bool(s["seconds"]) }
        if has("date") { o.date = DesignGate.bool(s["date"]) }
        if has("align") { o.align = DesignGate.pick(s["align"], ["left", "center", "right"]) }
        if has("show") { o.show = DesignGate.pick(s["show"], ["date", "weather", "both"]) }
        if has("dfmt") { o.dfmt = DesignGate.pick(s["dfmt"], DesignDates.keys) }
        if has("cities") { o.cities = DesignGate.list(s["cities"]).prefix(4).compactMap(DesignGate.timeZone) }
        if has("month") { o.month = DesignGate.int(s["month"], 1, 12) }
        if has("day") { o.day = DesignGate.int(s["day"], 1, 31) }
        if has("unit") { o.unit = DesignGate.pick(s["unit"], ["sleeps", "days", "weeks"]) }
        if has("icon"), let i = s["icon"] as? String, i.range(of: "^[a-z][a-z-]{1,23}$", options: .regularExpression) != nil { o.icon = i }
        if has("apps") { o.apps = DesignGate.list(s["apps"]).prefix(16).compactMap(DesignGate.pkgOk) }
        if has("cols") { o.cols = DesignGate.int(s["cols"], 1, 6) }
        if has("names") { o.names = DesignGate.bool(s["names"]) }
        if has("more") { o.more = DesignGate.bool(s["more"]) }
        if has("image") { o.image = DesignGate.image(s["image"]) }
        if has("fit") { o.fit = DesignGate.pick(s["fit"], ["cover", "contain"]) }
        if has("mat") { o.mat = DesignGate.colour(s["mat"]) }
        if has("place") { o.place = DesignGate.bool(s["place"]) }
        if has("hilo") { o.hilo = DesignGate.bool(s["hilo"]) }
        if has("quick") { o.quick = DesignGate.list(s["quick"]).prefix(6).compactMap { DesignGate.pick($0, quickIds) } }
        if has("count") { o.count = DesignGate.int(s["count"], 1, 8) }
        if has("shows") { o.shows = DesignGate.int(s["shows"], 1, 5) }
        return o
    }
}

/// One thing placed on the screen: text, shape, clock, weather, smart, group or widget.
struct DesignObject: Equatable, Identifiable {
    var id: String
    var type: String
    var layer = "front"
    var place = DesignPlace()
    var w: Double?
    var h: Double?
    var text: String?
    var size: Double?
    var textType = DesignType()
    var variant: String?          // shape: glass, solid, outline, line
    var radius: Double?
    var colour: String?
    var format: String?           // clock
    var showDate = false
    var dateFormat: String?
    var style: String?            // weather: line, card, big; smart: tile, pill, icon, card
    var placeName: Bool?
    var panel: String?
    var kind: String?             // widget kind, or the smart kind
    var widgetStyle = DesignWidgetStyle()
    var opts = DesignWidgetOpts()
    var items: [DesignObject] = []          // a smart stack's widgets
    var turn: Int = 0
    var controls: [String] = []             // a section's control names

    static let types = ["text", "shape", "clock", "weather", "smart", "group", "widget"]
    static let smartKinds = ["aircon", "light", "speaker", "camera", "doorbell", "network", "devices", "vacuum", "appliance", "scene"]

    static func read(_ raw: Any?) -> DesignObject? {
        let s = DesignGate.dict(raw)
        guard let id = DesignGate.idOk(s["id"]), let type = DesignGate.pick(s["type"], types) else { return nil }
        var o = DesignObject(id: id, type: type)
        o.layer = DesignGate.pick(s["layer"], ["front", "back"]) ?? "front"
        o.place = .read(s)
        if type != "shape", type != "text" { o.w = DesignGate.num(s["w"], 40, 1920); o.h = DesignGate.num(s["h"], 40, 1080) }
        switch type {
        case "text":
            guard let t = DesignGate.words(s["text"], 120), !t.isEmpty else { return nil }
            o.text = t
            o.size = DesignGate.num(s["size"], 8, 400)
            o.textType = .read(s)
            // words stay a readable size
            let px = (o.size ?? 56) * o.place.scale
            if px > 300 { o.place.scale = ((300 / (o.size ?? 56)) * 1000).rounded() / 1000 }
        case "shape":
            o.variant = DesignGate.pick(s["variant"], ["glass", "solid", "outline", "line"])
            o.w = DesignGate.num(s["w"], 4, 3840)
            o.h = DesignGate.num(s["h"], 1, 2160)
            o.radius = DesignGate.num(s["radius"], 0, 1000)
            o.colour = DesignGate.colour(s["colour"])
        case "clock":
            o.size = DesignGate.num(s["size"], 16, 600)
            o.format = DesignGate.pick(s["format"], ["12h", "24h"])
            o.showDate = DesignGate.bool(s["date"]) ?? false
            o.dateFormat = DesignGate.pick(s["date_format"], DesignDates.keys)
            o.textType = .read(s)
        case "weather":
            o.style = DesignGate.pick(s["style"], ["line", "card", "big"])
            o.placeName = DesignGate.bool(s["place"])
            o.panel = DesignGate.pick(s["panel"], ["glass", "solid", "none"])
            o.textType = .read(s)
        case "smart":
            o.kind = DesignGate.pick(s["kind"], smartKinds) ?? "light"
            o.style = DesignGate.pick(s["style"], ["tile", "pill", "icon", "card"])
            o.panel = DesignGate.pick(s["panel"], ["glass", "solid", "none"])
        case "group":
            o.layer = "back"
            o.panel = DesignGate.pick(s["panel"], ["glass", "solid", "none"])
            o.controls = DesignGate.list(s["controls"]).prefix(32).compactMap { c -> String? in
                let d = DesignGate.dict(c)
                if let app = DesignGate.pkgOk(d["app"]) { return app }
                return DesignGate.words(d["name"], 24).flatMap { $0.isEmpty ? nil : $0 } ?? DesignGate.pick(d["kind"], smartKinds)
            }
        default:  // widget
            o.place.rotate = 0
            o.place.scale = 1
            guard read(widget: s, into: &o, inStack: false) else { return nil }
            o.w = Swift.min(1760, o.w ?? 360)
            o.h = Swift.min(960, o.h ?? 360)
        }
        if type != "shape" && type != "widget" { o.place.scale = Swift.min(3, o.place.scale) }
        return o
    }

    private static func read(widget s: [String: Any], into o: inout DesignObject, inStack: Bool) -> Bool {
        // a kind this Apple TV does not know (a newer couch-tv Studio widget) still keeps its place as a plain
        // "Widget" card, so the design does not have a hole in it. Its own name is never drawn. Not in a stack.
        let named = DesignGate.pick(s["kind"], DesignWidgets.kinds)
        let unknown = named == nil && !inStack && (s["kind"] as? String)?.range(of: "^[a-z][a-z0-9_-]{1,31}$", options: .regularExpression) != nil
        guard let kind = named ?? (unknown ? DesignWidgets.other : nil), !(inStack && kind == "stack") else { return false }
        o.kind = kind
        o.widgetStyle = .read(DesignGate.dict(s["style"]))
        o.opts = .read(kind, DesignGate.dict(s["opts"]))
        if kind == "stack" {
            o.items = DesignGate.list(s["items"]).prefix(10).compactMap { it -> DesignObject? in
                var child = DesignObject(id: o.id + "-" + String(UUID().uuidString.prefix(6)), type: "widget")
                return read(widget: DesignGate.dict(it), into: &child, inStack: true) ? child : nil
            }
            o.turn = [0, 10, 20, 30, 60].contains(DesignGate.int(s["turn"], 0, 60) ?? -1) ? (DesignGate.int(s["turn"], 0, 60) ?? 0) : 0
            if o.items.isEmpty { return false }
        }
        return true
    }
}

struct DesignText: Equatable, Identifiable {
    var id: String
    var text: String
    var place: DesignPlace
    var size: Double?
    var type: DesignType
}

struct DesignApps: Equatable {
    var order: [String] = []
    var hidden: [String] = []
}

struct DesignHome: Equatable {
    var clock: String?
    var keepWatching: Bool?
    var dockSize: Int?
    var scenes: [String] = []    // the built in scenes the design keeps (one, or several taking turns); none is all
}

/// A whole design, after the gate. Only what is listed here reaches the screen.
struct Design: Equatable {
    var home = DesignHome()
    var elements: [String: DesignPart] = [:]
    var background: DesignBackground?
    var apps = DesignApps()
    var texts: [DesignText] = []
    var objects: [DesignObject] = []
    var look = DesignLook()

    /// Read a design from JSON already parsed. nil when it is not an object at all.
    static func read(_ any: Any?) -> Design? {
        guard let raw = any as? [String: Any] else { return nil }
        var d = Design()
        let hm = DesignGate.dict(raw["home"])
        d.home = DesignHome(clock: DesignGate.pick(hm["clock"], ["12h", "24h"]), keepWatching: DesignGate.bool(hm["keep_watching"]),
                            dockSize: DesignGate.int(hm["dock_size"], 1, 10),
                            scenes: DesignGate.list(hm["scenes"]).prefix(20).compactMap { x -> String? in
                                guard let s = x as? String, s.count <= 40,
                                      s.allSatisfy({ ($0.isASCII && ($0.isLowercase || $0.isNumber)) || $0 == "_" || $0 == "-" }), !s.isEmpty
                                else { return nil }
                                return s
                            })
        let el = DesignGate.dict(raw["elements"])
        for k in DesignPart.keys where el[k] != nil { d.elements[k] = DesignPart.read(k, DesignGate.dict(el[k])) }
        d.background = DesignBackground.read(DesignGate.dict(raw["background"]))
        let ap = DesignGate.dict(raw["apps"])
        d.apps = DesignApps(order: DesignGate.list(ap["order"]).prefix(40).compactMap(DesignGate.pkgOk),
                            hidden: DesignGate.list(ap["hidden"]).prefix(200).compactMap(DesignGate.pkgOk))
        d.texts = DesignGate.list(raw["texts"]).prefix(8).enumerated().compactMap { i, t -> DesignText? in
            let s = DesignGate.dict(t)
            guard let words = DesignGate.words(s["text"], 120), !words.isEmpty else { return nil }
            return DesignText(id: DesignGate.idOk(s["id"]) ?? "text\(i)", text: words, place: .read(s),
                              size: DesignGate.num(s["size"], 8, 400), type: .read(s))
        }
        var seen = Set<String>()
        d.objects = DesignGate.list(raw["objects"]).prefix(40).compactMap(DesignObject.read).filter { seen.insert($0.id).inserted }
        d.look = .read(DesignGate.dict(raw["look"]))
        return d
    }

    static func read(data: Data) -> Design? {
        read((try? JSONSerialization.jsonObject(with: data)) as Any?)
    }

    func part(_ key: String) -> DesignPart? { elements[key] }

    /// The home's own clock drawn by the built in scenes (clock.at "scene", no background of the design's own):
    /// the Night home, with the clock behind the hills and on the water of the Waterline scene.
    var sceneClock: Bool { background == nil && shows("clock") && part("clock")?.at == "scene" }

    /// A home part shows unless the design hides it.
    func shows(_ key: String) -> Bool { !(elements[key]?.place.hidden ?? false) }

    /// The dock's apps in the design's order, without the ones it hides.
    func order(_ ids: [String]) -> [String] {
        let hidden = Set(apps.hidden)
        let first = apps.order.filter { ids.contains($0) && !hidden.contains($0) }
        return first + ids.filter { !first.contains($0) && !hidden.contains($0) }
    }

    /// Objects back to front: the back layer first, then the rest, in the design's order.
    var drawOrder: [DesignObject] {
        objects.filter { $0.layer == "back" && !$0.place.hidden } + objects.filter { $0.layer != "back" && !$0.place.hidden }
    }
}

// MARK: - the widget kinds

enum DesignWidgets {
    /// Every kind couch-tv Studio has (design.js WKINDS). Anything else is dropped by the gate.
    static let kinds = ["clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "solar", "worldclock", "countdown", "date", "month", "timer",
                        "weather", "bigtemp", "hourly", "week", "rain", "uv", "sun", "moon", "air", "surf",
                        "photo", "slideshow", "mosaic", "artframe", "memory",
                        "keep", "keeprow", "upnext", "picks",
                        "app", "folder", "dock", "appgrid", "games",
                        "nowplaying", "soundscape", "queue", "speakers",
                        "aircon", "scenes", "controls", "camera", "doorbell", "energy", "sensor", "battery",
                        "bins", "people", "agenda", "note", "list",
                        "card", "quote", "word", "news", "sports", "stocks", "commute",
                        "welcome", "quick", "wifi", "guide", "screentime", "ask", "agent", "stack"]

    /// The options each kind takes (design.js WOPT).
    static let options: [String: String] = [
        "clock": "format ampm seconds date align", "tallclock": "format align", "glassclock": "format scene", "analog": "seconds",
        "flipclock": "format", "worldclock": "label cities", "countdown": "label month day unit icon", "date": "show dfmt align place",
        "timer": "label", "weather": "place hilo night", "bigtemp": "place", "hourly": "place", "week": "place", "rain": "label",
        "uv": "label", "sun": "label", "air": "label", "surf": "label", "photo": "image fit caption sub",
        "slideshow": "seconds_each caption sub", "mosaic": "count", "artframe": "image mat caption sub", "memory": "align",
        "keeprow": "label shows", "upnext": "apps sport", "picks": "label align", "app": "apps", "folder": "label apps cols",
        "dock": "apps more", "appgrid": "apps cols names", "games": "label apps", "soundscape": "sound", "aircon": "entity",
        "scenes": "label", "controls": "label controls cols switches align", "camera": "label cam align", "doorbell": "label align",
        "energy": "label align", "sensor": "label reading align", "speakers": "label players align", "queue": "label align",
        "bins": "label weekday alt anchor lid_a lid_b bin_a bin_b", "agenda": "label align", "note": "align",
        "list": "label icon align", "card": "label text icon", "quote": "text sub", "news": "feed label align",
        "sports": "label league team align", "stocks": "label tickers align", "commute": "label arrive_h arrive_m buffer weekdays align",
        "welcome": "kicker text sub align source times", "quick": "quick align", "wifi": "align", "guide": "align",
        "screentime": "align", "ask": "label align", "agent": "label align",
    ]

    /// The kinds the Apple TV draws itself, from what it already has: the clock, the bridge's weather, the
    /// apps, Keep watching, the people, and the design's own words and pictures.
    static let native: Set<String> = ["clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "worldclock", "countdown",
                                      "date", "month", "weather", "bigtemp", "photo", "artframe", "keep", "keeprow",
                                      "app", "folder", "dock", "appgrid", "games", "people", "quick", "card", "quote",
                                      "welcome", "stack"]

    static func drawsNatively(_ kind: String) -> Bool { native.contains(kind) }

    /// The kind given to a widget this Apple TV does not know: drawn as a plain "Widget" card.
    static let other = "other"

    /// The tile colour each kind has when its style does not pick one (widgets.js TILE).
    static let tile: [String: String] = ["analog": "#f4f1ea", "wordclock": "#0a6fd8", "countdown": "#18793f", "weather": "#1b64b5",
                                         "bigtemp": "#ffb340", "hourly": "#1b64b5", "week": "#1b64b5", "uv": "#ff9f0a", "surf": "#0a6e8a",
                                         "screentime": "#5e5ce6", "note": "#ffd60a", "timer": "#1d1b18"]

    /// The panel a kind has when its style does not say (design.js WPANEL).
    static func panel(_ kind: String, _ style: DesignWidgetStyle) -> String {
        if let p = style.panel { return p }
        let bare: Set<String> = ["clock", "tallclock", "glassclock", "flipclock", "date", "welcome", "quote", "quick", "photo", "slideshow",
                                 "mosaic", "artframe", "memory", "keep", "keeprow", "upnext", "picks", "app", "appgrid", "camera", "stack"]
        let coloured: Set<String> = ["analog", "wordclock", "countdown", "weather", "bigtemp", "hourly", "week", "uv", "surf", "screentime", "note"]
        let solid: Set<String> = ["worldclock", "moon", "timer", "stocks", "battery"]
        if bare.contains(kind) { return "none" }
        if coloured.contains(kind) { return "colour" }
        if solid.contains(kind) { return "solid" }
        return kind == "word" ? "paper" : "glass"
    }

    /// The colour a widget's card is filled with (nil for glass and none).
    static func fill(panel: String, kind: String, style: DesignWidgetStyle, look: DesignLook) -> String? {
        switch panel {
        case "solid": return style.colour ?? look.solid ?? "rgba(23, 23, 23, 0.88)"
        case "paper": return style.colour ?? look.paper ?? "#faf8f2"
        case "colour": return style.colour ?? tile[kind] ?? look.accent ?? look.panel ?? "#2c2c34"
        default: return nil
        }
    }

    /// A light colour, so the words on it are drawn dark.
    static func light(_ c: String?) -> Bool {
        guard let r = DesignRGBA.parse(c), r.a > 0.5 else { return false }
        return 0.2126 * r.r + 0.7152 * r.g + 0.0722 * r.b > 0.6
    }

    /// A plain name for a kind, for the titled card of a kind drawn without its live data.
    static func title(_ kind: String) -> String {
        let names: [String: String] = [
            "solar": "Sunrise and sunset", "timer": "Timer", "hourly": "Hourly forecast", "week": "This week", "rain": "Rain",
            "uv": "UV", "sun": "Sun", "moon": "Moon", "air": "Air quality", "surf": "Surf", "slideshow": "Photos", "mosaic": "Photos",
            "memory": "Memories", "upnext": "Up next", "picks": "Picks for you", "nowplaying": "Now playing",
            "soundscape": "Soundscape", "queue": "Up next in music", "speakers": "Speakers", "aircon": "Air conditioning",
            "scenes": "Scenes", "controls": "Controls", "camera": "Camera", "doorbell": "Doorbell", "energy": "Energy",
            "sensor": "Sensor", "battery": "Batteries", "bins": "Bin night", "agenda": "Today", "list": "List", "word": "Word of the day",
            "news": "News", "sports": "Sport", "stocks": "Shares", "commute": "Commute", "wifi": "Wi-Fi", "guide": "House guide",
            "screentime": "Screen time", "ask": "Ask", "agent": "Assistant",
            "light": "Light", "speaker": "Speaker", "network": "Network", "devices": "Devices", "vacuum": "Vacuum",
            "appliance": "Appliance", "scene": "Scene", "group": "Controls", other: "Widget",
        ]
        return names[kind] ?? kind.prefix(1).uppercased() + kind.dropFirst()
    }

    /// An SF Symbol for each kind's titled card.
    static func symbol(_ kind: String) -> String {
        let s: [String: String] = [
            "solar": "sunrise", "timer": "timer", "hourly": "clock", "week": "calendar", "rain": "cloud.rain", "uv": "sun.max",
            "sun": "sun.horizon", "moon": "moon", "air": "aqi.medium", "surf": "water.waves", "slideshow": "photo.on.rectangle",
            "mosaic": "square.grid.2x2", "memory": "photo", "upnext": "play.rectangle", "picks": "sparkles",
            "nowplaying": "music.note", "soundscape": "waveform", "queue": "music.note.list", "speakers": "hifispeaker",
            "aircon": "thermometer", "scenes": "sparkles", "controls": "switch.2", "camera": "video", "doorbell": "bell",
            "energy": "bolt", "sensor": "sensor", "battery": "battery.75", "bins": "trash", "agenda": "calendar",
            "list": "list.bullet", "word": "textformat", "news": "newspaper", "sports": "sportscourt", "stocks": "chart.line.uptrend.xyaxis",
            "commute": "car", "wifi": "wifi", "guide": "house", "screentime": "hourglass", "ask": "bubble.left", "agent": "bubble.left",
            "light": "lightbulb", "speaker": "hifispeaker", "network": "network", "devices": "tv", "vacuum": "circle.circle",
            "appliance": "washer", "scene": "sparkles", "group": "switch.2",
        ]
        return s[kind] ?? "square.grid.2x2"
    }
}

// MARK: - the clock and the date as words

enum DesignDates {
    static let keys = ["short", "numeric", "weekday", "day_month", "full"]

    /// The time, 12 or 24 hour, as the TV home writes it: "8:47" or "08:47".
    static func time(_ d: Date, clock24: Bool, seconds: Bool = false, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute, .second], from: d)
        let h = c.hour ?? 0, m = c.minute ?? 0
        var s = (clock24 ? String(format: "%02d", h) : String(h % 12 == 0 ? 12 : h % 12)) + ":" + String(format: "%02d", m)
        if seconds { s += ":" + String(format: "%02d", c.second ?? 0) }
        return s
    }

    static func ampm(_ d: Date, calendar: Calendar = .current) -> String {
        (calendar.component(.hour, from: d) < 12) ? "AM" : "PM"
    }

    /// A date in one of the design's formats (design.js DATE_FORMATS), Australian English, no commas.
    static func text(_ d: Date, format: String?, locale: Locale = Locale(identifier: "en_AU"), timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = timeZone
        switch format {
        case "short": f.setLocalizedDateFormatFromTemplate("EEEdMMM")
        case "numeric": f.setLocalizedDateFormatFromTemplate("dMyyyy")
        case "weekday": f.dateFormat = "EEEE"
        case "day_month": f.setLocalizedDateFormatFromTemplate("dMMMM")
        case "full": f.setLocalizedDateFormatFromTemplate("EEEEdMMMMyyyy")
        default: f.setLocalizedDateFormatFromTemplate("EEEEdMMMM")
        }
        let s = f.string(from: d).replacingOccurrences(of: ",", with: "")
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// The time in words, for the word clock: "Quarter past eight".
    static func words(_ d: Date, calendar: Calendar = .current) -> String {
        let names = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"]
        let c = calendar.dateComponents([.hour, .minute], from: d)
        let m = Int((Double(c.minute ?? 0) / 5).rounded()) * 5
        var h = (c.hour ?? 0) % 12
        if m > 30 { h = (h + 1) % 12 }
        let hour = names[h]
        let s: String
        switch m {
        case 0, 60: s = "\(m == 60 ? names[(h) % 12] : hour) o'clock"
        case 15: s = "quarter past \(hour)"
        case 30: s = "half past \(hour)"
        case 45: s = "quarter to \(hour)"
        case let x where x < 30: s = "\(minuteWords(x)) past \(hour)"
        default: s = "\(minuteWords(60 - m)) to \(hour)"
        }
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    private static func minuteWords(_ m: Int) -> String {
        ["five": 5, "ten": 10, "twenty": 20, "twenty five": 25].first { $0.value == m }?.key ?? "five"
    }

    /// Days until the next month/day (today counts as 0), for the countdown.
    static func daysUntil(month: Int, day: Int, from now: Date, calendar: Calendar = .current) -> Int {
        let today = calendar.startOfDay(for: now)
        let y = calendar.component(.year, from: today)
        for year in [y, y + 1] {
            var c = DateComponents()
            (c.year, c.month, c.day) = (year, month, day)
            if let d = calendar.date(from: c), d >= today {
                return calendar.dateComponents([.day], from: today, to: d).day ?? 0
            }
        }
        return 0
    }
}

// MARK: - layout: design pixels to the screen

enum DesignLayout {
    static let width: Double = 1920
    static let height: Double = 1080

    /// How much to grow or shrink the 1920x1080 design for a view this wide.
    static func factor(width w: Double) -> Double { w > 0 ? w / width : 1 }

    /// An object's box in design pixels: x, y, width, height (a guess for parts with no w and h).
    static func box(_ o: DesignObject) -> (x: Double, y: Double, w: Double, h: Double) {
        switch o.type {
        case "shape": return (o.place.x, o.place.y, o.w ?? 600, o.variant == "line" ? (o.h ?? 4) : (o.h ?? 320))
        case "text": let s = o.size ?? 56; return (o.place.x, o.place.y, o.w ?? s * Double(o.text?.count ?? 4) * 0.6, s * 1.25)
        case "clock": let s = o.size ?? 120; return (o.place.x, o.place.y, o.w ?? s * 2.4, o.h ?? s * (o.showDate ? 1.45 : 1.1))
        case "weather":
            let st = o.style ?? "line"
            return (o.place.x, o.place.y, o.w ?? (st == "card" ? 330 : st == "big" ? 320 : 440), o.h ?? (st == "card" ? 180 : st == "big" ? 200 : 44))
        default: return (o.place.x, o.place.y, o.w ?? 360, o.h ?? 360)
        }
    }

    /// The corner radius for a widget's corners choice, for a box this size.
    static func corner(_ corners: String?, w: Double, h: Double) -> Double {
        switch corners {
        case "square": return 6
        case "soft": return 16
        case "pill": return Swift.min(w, h) / 2
        default: return 30
        }
    }
}

// MARK: - getting a design by code (tv-home/web/design-code.js)

enum DesignCode {
    static let defaultStore = "https://tvdesigner.sites.underseage.studio"      // designer-gate.js DEFAULT_STORE
    static let maxBytes = 4_000_000
    static let shortLetters = Array("23456789ABCDEFGHJKMNPQRSTVWXYZ")

    /// A code as typed with the remote: ABCDE-FGHJK (any case, spaces and dashes ignored), or the long one
    /// from the QR (CTV1-...). nil for anything else, which is never sent anywhere.
    static func read(_ typed: String) -> String? {
        let s = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        var long = s
        if long.lowercased().hasPrefix("ctv1-") { long = String(long.dropFirst(5)) }
        if long.count == 43, long.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }) { return "CTV1-" + long }
        let c = s.uppercased().filter { $0 != "-" && !$0.isWhitespace }
        guard c.count == 10, c.allSatisfy({ shortLetters.contains($0) }) else { return nil }
        return String(c.prefix(5)) + "-" + String(c.suffix(5))
    }

    /// https only; plain http only to this computer. No path.
    static func cleanBase(_ v: Any?) -> String? {
        guard let u = v as? String, u.count <= 200 else { return nil }
        let t = u.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = "^(https://[a-z0-9.-]+(:\\d{1,5})?|http://(127\\.0\\.0\\.1|localhost)(:\\d{1,5})?)/?$"
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let m = re.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)), let r = Range(m.range(at: 1), in: t) else { return nil }
        return String(t[r]).lowercased()
    }

    /// The store to ask: config.json "design_store" when it has a good one; "" turns getting a design off;
    /// no key at all means couch-tv Studio's own store.
    static func store(config: [String: Any]?) -> String? {
        guard let config, config.keys.contains("design_store") else { return defaultStore }
        return cleanBase(config["design_store"])
    }

    /// What a failed fetch means, in the TV home's words.
    static func message(status: Int) -> String {
        switch status {
        case 404: return "That code did not work. A code works once, for 30 minutes. Make a new one in couch-tv Studio."
        case 429: return "Too many tries. Wait a few minutes, then try again."
        case 503: return "Short codes are paused for a few minutes. Try again soon."
        default: return "Could not reach the design server. Check the Apple TV is online."
        }
    }

    static let notACode = "That is not a design code. It looks like ABCDE-FGHJK."
    static let badDesign = "That design could not be used."

    /// A JPEG inside the design, checked by its first bytes (FF D8 FF).
    static func jpegOk(_ u: String) -> Bool {
        let prefix = "data:image/jpeg;base64,"
        guard u.hasPrefix(prefix) else { return false }
        let b64 = String(u.dropFirst(prefix.count))
        guard b64.range(of: "^[A-Za-z0-9+/]+={0,2}$", options: .regularExpression) != nil,
              let head = Data(base64Encoded: String(b64.prefix(8))), head.count >= 3 else { return false }
        return head[head.startIndex] == 0xFF && head[head.startIndex + 1] == 0xD8 && head[head.startIndex + 2] == 0xFF
    }

    /// The store's answer: only its "design" is kept, and its background picture only when it is a JPEG
    /// (checked by its bytes) or one of couch-tv's own backgrounds/<name>.jpg. nil when it is not a design.
    static func accept(_ data: Data) -> [String: Any]? {
        guard data.count <= maxBytes, let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              var d = j["design"] as? [String: Any] else { return nil }
        if var bg = d["background"] as? [String: Any] {
            if let img = bg["image"] {
                let ok = (img as? String).map { jpegOk($0) || $0.range(of: "^backgrounds/[A-Za-z0-9_-]+\\.jpe?g$", options: .regularExpression) != nil } ?? false
                if !ok { bg.removeValue(forKey: "image") }
            }
            bg.removeValue(forKey: "video")          // never a video on the Apple TV
            bg.removeValue(forKey: "depth_image")
            d["background"] = bg
        }
        return d
    }
}

// MARK: Get a design from your phone (DesignStore.swift asks; tv-home/web/design-code.js openInbox, takeInbox)

/// A one time inbox at couch-tv Studio: the QR holds `link`; the phone puts a design code in it, and this
/// Apple TV asks for it every `every` seconds while the screen showing the QR is open, and only then.
/// Only a code ever comes back, and it is got exactly as a typed one: "Use this design?" first, always.
struct DesignInbox: Equatable {
    let id: String
    let link: String
    let expires: Date
    let every: Double

    static func validId(_ s: String) -> Bool {
        s.count == 22 && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }

    /// The store's answer to "open", or nil when it is not one.
    static func read(_ data: Data, base: String, now: Date = Date()) -> DesignInbox? {
        guard let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = j["id"] as? String, validId(id) else { return nil }
        let secs = min(1800, max(60, (j["expires_in"] as? Double) ?? 600))
        let every = min(30, max(3, (j["poll_every"] as? Double) ?? 4))
        return DesignInbox(id: id, link: base + "/design/#inbox=" + id, expires: now.addingTimeInterval(secs), every: every)
    }

    enum Take: Equatable { case waiting, code(String), gone, problem(String) }

    /// The store's answer to "take": a code (read as a typed one), still waiting, or run out.
    static func readTake(status: Int, data: Data) -> Take {
        if status == 404 { return .gone }
        guard status == 200, let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return .problem("Could not reach couch-tv Studio. Check the Apple TV is online, or type the code instead.")
        }
        if j["state"] as? String == "ok" {
            guard let c = j["code"] as? String, let code = DesignCode.read(c) else { return .gone }
            return .code(code)
        }
        return .waiting
    }
}
