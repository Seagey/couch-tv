// A couch-tv Studio design drawn natively (docs/APPLE-TV.md, "A design from couch-tv Studio"). The design is
// read and checked in DesignModel.swift; this only draws it. Everything is laid out in pixels of a
// 1920x1080 screen, then grown or shrunk to the view's width. The apps keep the home's own focus and
// open the same way (HomeModel.open). Settings is always reachable: in the dock, or a gear of its own.
import SwiftUI

struct DesignHomeView: View {
    @EnvironmentObject var model: HomeModel
    var design: Design? = nil                  // the preview renderer and the question pass one in
    var now: Date? = nil                       // the preview renderer fixes the time
    var interactive = true                     // false: a picture of the design (the question's preview)
    @FocusState private var focus: HomeFocus?

    var body: some View {
        TimelineView(.everyMinute) { tl in
            let date = now ?? tl.date
            GeometryReader { g in
                DesignCanvas(design: design ?? model.design ?? Design(), date: date, focus: $focus, interactive: interactive)
                    .frame(width: 1920, height: 1080)
                    .scaleEffect(DesignLayout.factor(width: g.size.width), anchor: .topLeading)
                    .frame(width: g.size.width, height: g.size.height, alignment: .topLeading)
            }
        }
        .ignoresSafeArea()
        .defaultFocus($focus, model.dockApps.first.map { HomeFocus.app($0.id) } ?? .settings)
    }
}

/// The design at 1920x1080: the background, the back layer, the home's own parts, words, the front layer.
struct DesignCanvas: View {
    @EnvironmentObject var model: HomeModel
    let design: Design
    let date: Date
    var focus: FocusState<HomeFocus?>.Binding
    var interactive = true

    var body: some View {
        let d = design
        ZStack(alignment: .topLeading) {
            if d.sceneClock {
                // the Night home: the scenes themselves, the clock behind the hills (and on the water)
                let late = Calendar.current.component(.hour, from: date) >= 21 || Calendar.current.component(.hour, from: date) < 6
                let look = sceneLook
                SceneBackdrop(look: look, time: DesignDates.time(date, clock24: clock24), late: late)
                    .id(look.id)
                    .transition(.opacity)
            } else {
                DesignBackdrop(background: d.background, look: sceneLook)
            }
            ForEach(d.drawOrder.filter { $0.layer == "back" }) { o in DesignObjectView(design: d, object: o, date: date, focus: focus) }
            parts
            ForEach(d.texts) { t in
                DesignWords(text: t.text, size: t.size ?? 56, type: t.type, look: d.look)
                    .fixedSize()
                    .placed(t.place)
            }
            ForEach(d.drawOrder.filter { $0.layer != "back" }) { o in DesignObjectView(design: d, object: o, date: date, focus: focus) }
            if !d.shows("dock") && !d.shows("quick") && !hasSettingsWidget {
                // the way back to Settings (and Plain home) is never designed away
                DesignTool(symbol: "gearshape", tag: "settings", name: "Settings", focusAs: .settings, focus: focus) { model.openSettings() }
                    .at(1920 - 80 - 96, 1080 - 60 - 96)
            }
            if !model.message.isEmpty && interactive {
                Text(model.message)
                    .font(HomeFont.inter(23, .medium)).foregroundStyle(.white.opacity(0.9))
                    .shadow(color: .black.opacity(0.5), radius: 8, y: 2)
                    .frame(width: 1920, alignment: .center)
                    .at(0, 842)
            }
        }
        .frame(width: 1920, height: 1080, alignment: .topLeading)
        .clipped()
        .allowsHitTesting(interactive)
        .environment(\.designClock24, d.home.clock.map { $0 == "24h" } ?? model.clock24)
    }

    private var clock24: Bool {
        let p = design.part("clock") ?? DesignPart()
        return p.format.map { $0 == "24h" } ?? (design.home.clock.map { $0 == "24h" } ?? model.clock24)
    }

    /// The scene on now: the design's own scenes (one, or several taking turns with the home's), else the home's.
    private var sceneLook: SceneLook {
        let known = Set(SceneLook.all.map(\.id))
        let mine = design.home.scenes.filter { known.contains($0) }
        if mine.isEmpty { return model.look }
        return SceneLook.byId(mine[model.sceneTurn % mine.count])
    }

    private var hasSettingsWidget: Bool {
        design.objects.contains { ["quick", "dock"].contains($0.kind ?? "") && !$0.place.hidden }
    }

    // MARK: the home's own parts, where the design moved them

    @ViewBuilder private var parts: some View {
        let d = design
        if d.shows("clock") && !d.sceneClock {
            let p = d.part("clock") ?? DesignPart()
            let c24 = p.format.map { $0 == "24h" } ?? (d.home.clock.map { $0 == "24h" } ?? model.clock24)
            DesignWords(text: DesignDates.time(date, clock24: c24), size: 400, type: p.type, look: d.look,
                        defaultFont: "antonio", glass: p.style != "solid")
                .fixedSize()
                .frame(width: 1920, alignment: .center)
                .moved(p.place, anchor: .top)
                .at(0, 120)
        }
        if d.sceneClock && d.shows("date") {
            // the scene's own date line, where and in the colour each scene puts it (dark on the Fog scene's pale sky)
            DateLine(look: sceneLook, date: date)
                .id("date-" + sceneLook.id)
                .transition(.opacity)
        } else if d.shows("date") || (d.shows("weather") && model.weather != nil) {
            HStack(spacing: 18) {
                if d.shows("date") {
                    let p = d.part("date") ?? DesignPart()
                    DesignWords(text: DesignDates.text(date, format: p.format), size: 34, type: p.type, look: d.look, defaultWeight: 500)
                        .fixedSize()
                        .moved(p.place, anchor: .top)
                }
                if d.shows("weather"), let w = model.weather {
                    let p = d.part("weather") ?? DesignPart()
                    let words = (p.words ?? true) ? (w.text ?? HomeModel.weatherWords(w.code)) : ""
                    HStack(spacing: 8) {
                        Image(systemName: HomeModel.weatherSymbol(w)).font(.system(size: 28, weight: .light))
                        DesignWords(text: model.tempText(w) + (words.isEmpty ? "" : " " + words), size: 34, type: p.type, look: d.look)
                    }
                    .foregroundStyle(DesignPaint.colour(p.type.colour) ?? .white)
                    .fixedSize()
                    .moved(p.place, anchor: .top)
                }
            }
            .frame(width: 1920, alignment: .center)
            .at(0, 70)
        }
        if d.shows("people"), model.people.count > 1 {
            let p = d.part("people") ?? DesignPart()
            DesignPeople(panel: p.panel ?? "glass", focus: focus)
                .moved(p.place, anchor: .topLeading)
                .at(80, 60)
        }
        if d.shows("quick") {
            let p = d.part("quick") ?? DesignPart()
            DesignQuick(ids: ["sleep"], settings: !d.shows("dock"), focus: focus)
                .moved(p.place, anchor: .topTrailing)
                .frame(width: 1920 - 80, alignment: .topTrailing)
                .at(0, 60)
        }
        if d.shows("keep_watching"), !model.items.isEmpty, d.home.keepWatching != false {
            let p = d.part("keep_watching") ?? DesignPart()
            HStack(spacing: 22) {
                ForEach(model.items.prefix(3)) { item in
                    Button { model.resume(item) } label: {
                        Focused(tag: "card:" + item.id) { f in ContinueCard(item: item, focused: f) }
                    }
                    .buttonStyle(BareButton())
                    .focused(focus, equals: .card(item.id))
                }
            }
            .focusSection()
            .moved(p.place, anchor: .topLeading)
            .at(80, 640)
        }
        if d.shows("dock") {
            let p = d.part("dock") ?? DesignPart()
            DesignDock(design: d, part: p, focus: focus)
                .moved(p.place, anchor: .bottom)
                .frame(width: 1920, height: 1080 - 46, alignment: .bottom)
        }
    }
}

// MARK: - the background

struct DesignBackdrop: View {
    let background: DesignBackground?
    let look: SceneLook

    var body: some View {
        ZStack {
            Color.black
            if let bg = background, let src = bg.image {
                if let img = DesignPictures.image(src) {
                    Image(platform: img).resizable().scaledToFill()
                        .frame(width: 1920, height: 1080)
                        .scaleEffect(bg.zoom, anchor: UnitPoint(x: bg.x / 100, y: bg.y / 100))
                        .blur(radius: bg.blur)
                        .frame(width: 1920, height: 1080)
                        .clipped()
                } else {
                    LinearGradient(colors: [Color(red: 0.16, green: 0.12, blue: 0.2), Color(red: 0.04, green: 0.04, blue: 0.06)],
                                   startPoint: .top, endPoint: .bottom)
                }
                if bg.darken > 0 { Color.black.opacity(bg.darken) }
                scrim(bg.scrim)
            } else if let bg = background, let c1 = DesignPaint.colour(bg.colour) {
                if let c2 = DesignPaint.colour(bg.colour2) {
                    if bg.radial {
                        RadialGradient(colors: [c1, c2], center: .center, startRadius: 0, endRadius: 1100)
                    } else {
                        let a = bg.angle * .pi / 180
                        let dx = sin(a) / 2, dy = -cos(a) / 2
                        LinearGradient(colors: [c1, c2], startPoint: UnitPoint(x: 0.5 - dx, y: 0.5 - dy), endPoint: UnitPoint(x: 0.5 + dx, y: 0.5 + dy))
                    }
                } else {
                    c1
                }
            } else if let photo = Pictures.load(look.photo, ".jpg") {
                // no background in the design: the scene that is on now
                Image(platform: photo).resizable().frame(width: 1920, height: 1080).colorMultiply(Color(white: look.photoDim))
            }
        }
        .frame(width: 1920, height: 1080)
        .clipped()
    }

    @ViewBuilder private func scrim(_ side: String?) -> some View {
        let dark = Color.black.opacity(0.55)
        switch side {
        case "top": LinearGradient(colors: [dark, .clear], startPoint: .top, endPoint: .center)
        case "bottom": LinearGradient(colors: [.clear, dark], startPoint: .center, endPoint: .bottom)
        case "left": LinearGradient(colors: [dark, .clear], startPoint: .leading, endPoint: .center)
        case "right": LinearGradient(colors: [.clear, dark], startPoint: .center, endPoint: .trailing)
        case "even": Color.black.opacity(0.25)
        default: EmptyView()
        }
    }
}

/// Pictures inside a design (base64) or couch-tv's own backgrounds, decoded once and kept.
enum DesignPictures {
    private static var cache: [String: PlatformImage] = [:]
    private static var order: [String] = []

    static func image(_ src: String) -> PlatformImage? {
        let key = "\(src.utf8.count):" + String(src.prefix(48)) + String(src.suffix(48))
        if let img = cache[key] { return img }
        var img: PlatformImage?
        if src.hasPrefix("data:image/"), let comma = src.firstIndex(of: ",") {
            if let data = Data(base64Encoded: String(src[src.index(after: comma)...])) { img = PlatformImage(data: data) }
        } else if src.hasPrefix("backgrounds/") {
            let name = (src as NSString).lastPathComponent
            let base = (name as NSString).deletingPathExtension, ext = "." + (name as NSString).pathExtension
            img = Pictures.load(base, ext)
        }
        if let img {
            cache[key] = img
            order.append(key)
            if order.count > 6 { cache.removeValue(forKey: order.removeFirst()) }
        }
        return img
    }
}

// MARK: - colours and words

private struct DesignClock24Key: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var designClock24: Bool {
        get { self[DesignClock24Key.self] }
        set { self[DesignClock24Key.self] = newValue }
    }
}

enum DesignPaint {
    static func colour(_ s: String?) -> Color? {
        DesignRGBA.parse(s).map { Color(.sRGB, red: $0.r, green: $0.g, blue: $0.b, opacity: $0.a) }
    }

    static func font(_ name: String?, size: CGFloat, weight: Int?) -> Font {
        let w = weight ?? 400
        switch name {
        case "antonio": return .custom("CouchAntonio-Light", fixedSize: size)
        case "serif": return .system(size: size, weight: fontWeight(w), design: .serif)
        case "mono": return .system(size: size, weight: fontWeight(w), design: .monospaced)
        case "condensed": return .system(size: size, weight: fontWeight(w)).width(.condensed)
        default: return HomeFont.inter(size, fontWeight(w))
        }
    }

    static func fontWeight(_ w: Int) -> Font.Weight {
        switch w {
        case ..<250: return .light
        case ..<450: return .regular
        case ..<550: return .medium
        case ..<750: return .semibold
        default: return .bold
        }
    }
}

/// Words in a design's type: font, weight, colour, shadow or glow, upper case, alignment.
struct DesignWords: View {
    let text: String
    let size: Double
    let type: DesignType
    let look: DesignLook
    var defaultFont = "inter"
    var defaultWeight = 400
    var glass = false

    var body: some View {
        let colour = DesignPaint.colour(type.colour) ?? DesignPaint.colour(look.ink) ?? .white
        let shown = type.upper ? text.uppercased() : text
        let shadowOn = type.shade == "glow" || type.shadow != "none"
        let strong = type.shade == "glow" || type.shadow == "strong"
        Text(shown)
            .font(DesignPaint.font(type.font ?? defaultFont, size: size, weight: type.weight ?? defaultWeight))
            .kerning(type.upper ? size * 0.06 : 0)
            .multilineTextAlignment(type.align == "center" ? .center : type.align == "right" ? .trailing : .leading)
            .foregroundStyle(glass && type.colour == nil ? colour.opacity(0.88) : colour)
            .padding(type.shade == "panel" ? EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16) : EdgeInsets())
            .background {
                if type.shade == "panel" { RoundedRectangle(cornerRadius: 14).fill(Color(red: 8 / 255, green: 9 / 255, blue: 12 / 255).opacity(0.5)) }
            }
            .shadow(color: .black.opacity(shadowOn ? (strong ? 0.6 : 0.38) : 0), radius: strong ? 8 : 20, y: strong ? 3 : 2)
    }
}

// MARK: - placing

extension View {
    /// A part's move from where the home puts it: x and y, scale and turn about its anchor, faded.
    func moved(_ p: DesignPlace, anchor: UnitPoint) -> some View {
        scaleEffect(p.scale, anchor: anchor)
            .rotationEffect(.degrees(p.rotate), anchor: anchor)
            .opacity(p.opacity)
            .offset(x: p.x, y: p.y)
    }

    /// An object's place on the 1920x1080 screen by its top left corner.
    func placed(_ p: DesignPlace) -> some View {
        scaleEffect(p.scale, anchor: .topLeading)
            .rotationEffect(.degrees(p.rotate), anchor: .center)
            .opacity(p.opacity)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .offset(x: p.x, y: p.y)
    }
}

// MARK: - one object

struct DesignObjectView: View {
    @EnvironmentObject var model: HomeModel
    let design: Design
    let object: DesignObject
    let date: Date
    var focus: FocusState<HomeFocus?>.Binding

    var body: some View {
        let o = object
        let b = DesignLayout.box(o)
        Group {
            switch o.type {
            case "text":
                DesignWords(text: o.text ?? "", size: o.size ?? 56, type: o.textType, look: design.look).fixedSize()
            case "shape":
                DesignShape(object: o, look: design.look).frame(width: b.w, height: b.h)
            case "clock":
                VStack(alignment: alignment(o.textType.align), spacing: 4) {
                    DesignWords(text: DesignDates.time(date, clock24: clock24(o.format)), size: o.size ?? 120, type: o.textType,
                                look: design.look, defaultWeight: 600)
                    if o.showDate {
                        DesignWords(text: DesignDates.text(date, format: o.dateFormat), size: (o.size ?? 120) * 0.28, type: o.textType, look: design.look)
                    }
                }
                .fixedSize()
            case "weather":
                DesignWeatherObject(object: o, look: design.look).frame(width: b.w, height: b.h)
            case "widget":
                DesignWidget(design: design, widget: o, date: date, focus: focus).frame(width: b.w, height: b.h)
            default:
                // smart home and sections: the Apple TV has no Home Assistant of its own
                DesignTitledCard(kind: o.type == "group" ? "group" : (o.kind ?? "light"), label: nil, look: design.look, style: DesignWidgetStyle())
                    .frame(width: b.w, height: b.h)
            }
        }
        .placed(o.place)
    }

    @Environment(\.designClock24) private var c24
    private func clock24(_ f: String?) -> Bool { f.map { $0 == "24h" } ?? c24 }

    private func alignment(_ a: String?) -> HorizontalAlignment { a == "center" ? .center : a == "right" ? .trailing : .leading }
}

struct DesignShape: View {
    let object: DesignObject
    let look: DesignLook
    @Environment(\.flatGlass) private var flat

    var body: some View {
        let r = object.radius ?? (object.variant == "line" ? 0 : 28)
        let shape = RoundedRectangle(cornerRadius: r, style: .continuous)
        let colour = DesignPaint.colour(object.colour)
        switch object.variant ?? "glass" {
        case "solid": shape.fill(colour ?? Color.white.opacity(0.16))
        case "outline": shape.strokeBorder(colour ?? Color.white.opacity(0.6), lineWidth: 2)
        case "line": Rectangle().fill(colour ?? Color.white.opacity(0.6))
        default:
            ZStack {
                if flat { shape.fill(Color(white: 0.16).opacity(0.55)) } else { shape.fill(.ultraThinMaterial) }
                if let c = colour ?? DesignPaint.colour(look.panel) { shape.fill(c) }
                shape.strokeBorder(DesignPaint.colour(look.rim) ?? Color.white.opacity(0.16), lineWidth: 1)
            }
        }
    }
}

/// The weather as a placed object: a line, a card or big.
struct DesignWeatherObject: View {
    @EnvironmentObject var model: HomeModel
    let object: DesignObject
    let look: DesignLook

    var body: some View {
        let ink = DesignPaint.colour(object.textType.colour) ?? DesignPaint.colour(look.ink) ?? .white
        Group {
            if let w = model.weather {
                let words = w.text ?? HomeModel.weatherWords(w.code)
                switch object.style ?? "line" {
                case "big":
                    VStack(spacing: 6) {
                        Image(systemName: HomeModel.weatherSymbol(w)).font(.system(size: 64, weight: .light))
                        Text(model.tempText(w)).font(DesignPaint.font(object.textType.font, size: 110, weight: object.textType.weight ?? 300))
                        Text(words).font(HomeFont.inter(28))
                    }
                case "card":
                    HStack(spacing: 22) {
                        Image(systemName: HomeModel.weatherSymbol(w)).font(.system(size: 70, weight: .light))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.tempText(w)).font(DesignPaint.font(object.textType.font, size: 72, weight: object.textType.weight ?? 500))
                            Text(words).font(HomeFont.inter(26))
                        }
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .modifier(DesignPanel(panel: object.panel ?? "glass", look: look, style: DesignWidgetStyle(), radius: 30))
                default:
                    HStack(spacing: 10) {
                        Image(systemName: HomeModel.weatherSymbol(w)).font(.system(size: 30, weight: .light))
                        Text(model.tempText(w) + (words.isEmpty ? "" : "  " + words)).font(DesignPaint.font(object.textType.font, size: 34, weight: object.textType.weight ?? 500))
                    }
                }
            } else {
                DesignTitledCard(kind: "weather", label: "Weather", look: look, style: DesignWidgetStyle())
            }
        }
        .foregroundStyle(ink)
        .shadow(color: .black.opacity(object.textType.shadow == "none" ? 0 : 0.3), radius: 12, y: 2)
    }
}

// MARK: - panels

/// A widget's card: glass, solid, colour, paper or none, in the design's shared look.
struct DesignPanel: ViewModifier {
    let panel: String
    let look: DesignLook
    let style: DesignWidgetStyle
    let radius: Double
    var kind = ""
    @Environment(\.flatGlass) private var flat

    func body(content: Content) -> some View {
        let fill = DesignPaint.colour(DesignWidgets.fill(panel: panel, kind: kind, style: style, look: look))
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                ZStack {
                    switch panel {
                    case "none": Color.clear
                    case "solid", "paper", "colour": shape.fill(fill ?? Color(white: 0.09).opacity(0.88))
                    default:
                        if flat { shape.fill(Color(red: 40 / 255, green: 30 / 255, blue: 38 / 255).opacity(0.55)) } else { shape.fill(.ultraThinMaterial) }
                        shape.fill(DesignPaint.colour(style.colour) ?? DesignPaint.colour(look.panel) ?? Color(red: 30 / 255, green: 20 / 255, blue: 28 / 255).opacity(0.32))
                    }
                    if panel != "none" {
                        shape.strokeBorder(DesignPaint.colour(look.rim) ?? Color.white.opacity(0.14), lineWidth: 1)
                    }
                }
                .opacity(style.opacity ?? 1)
                .shadow(color: .black.opacity(style.shadow == "none" || panel == "none" ? 0 : (style.shadow == "lifted" ? 0.4 : 0.25)), radius: 26, y: 18)
            }
    }
}

/// A kind this Apple TV does not draw says so by its name (widget-caps.js name), with where it does show.
/// Never a label from the design (a surf widget's beach, an aircon's room): there is no data here behind it.
enum DesignNotHere {
    static let names: [String: String] = [
        "clock": "Digital clock", "tallclock": "Tall clock", "glassclock": "Glass clock", "analog": "Analogue clock",
        "flipclock": "Flip clock", "wordclock": "Time in words", "solar": "Sun clock", "worldclock": "World clocks",
        "countdown": "Countdown", "date": "Date", "month": "Month", "timer": "Timer", "weather": "Weather",
        "bigtemp": "Big number", "hourly": "Hourly", "week": "This week", "rain": "Rain soon", "uv": "UV index",
        "sun": "Sunrise and sunset", "moon": "Moon", "air": "Air quality", "surf": "Surf", "photo": "Photo",
        "slideshow": "Slideshow", "mosaic": "Photo mosaic", "artframe": "Art frame", "memory": "On this day",
        "keep": "Keep watching", "keeprow": "Keep watching row", "upnext": "Up next", "picks": "Picks for you", "app": "One app",
        "folder": "App folder", "dock": "Dock", "appgrid": "App grid", "games": "Games", "nowplaying": "Now playing",
        "soundscape": "Soundscape", "queue": "Up next queue", "speakers": "Speakers", "aircon": "Aircon", "scenes": "Scenes",
        "controls": "Control Centre", "camera": "Camera", "doorbell": "Doorbell", "energy": "Solar and energy",
        "sensor": "Sensor", "battery": "Batteries", "bins": "Bin night", "people": "People", "agenda": "Agenda",
        "note": "Family note", "list": "List", "card": "Custom card", "quote": "Quote", "word": "Word of the day",
        "news": "Headlines", "sports": "Scores", "stocks": "Markets", "commute": "Commute", "welcome": "Welcome words",
        "quick": "Quick buttons", "wifi": "Guest Wi-Fi", "guide": "House guide", "screentime": "Screen time", "ask": "Ask AI",
        "agent": "From your AI", "stack": "Smart stack"
    ]
    static let line = "Shows on Google TV, Android TV and Fire TV"
    static func name(_ kind: String) -> String { names[kind] ?? "This widget" }
    static func title(_ kind: String) -> String { name(kind) + ": not on this TV" }
}

/// couch-tv Studio's sample words in its starter designs (app/templates.js), as widgets.js WELCOME_SAMPLE
/// and WELCOME_SAMPLE_LINES: on a real TV they are a stranger's name and a made up house, so they never
/// show. The greeting stays.
enum DesignWelcomeSample {
    static let text: [String: String] = ["Welcome, Ella and friends": "Welcome", "Hi Ruby!": "Hi!"]
    static let lines: [String] = ["Headland House, North Point", "Tuesday to Sunday. Night two of five", "Three sleeps till the beach"]
    static func greeting(_ t: String?) -> String? { t.map { text[$0] ?? (lines.contains($0) ? "Welcome" : $0) } }
    static func line(_ t: String?) -> String? { t.flatMap { lines.contains($0) ? nil : $0 } }
}

/// The card for a kind not drawn here: its symbol, "<name>: not on this TV", and where it shows.
struct DesignNotHereCard: View {
    let kind: String
    let look: DesignLook
    let style: DesignWidgetStyle

    var body: some View {
        let p = DesignWidgets.panel(kind, style)
        let panel = p == "none" ? "glass" : p
        let ink = DesignInk.colour(style: style, panel: panel, look: look, kind: kind)
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            // a short box (a 40 px pill) has room for the title alone, on one line
            let short = g.size.height < 110
            let pad = short ? max(2, min(16, g.size.height * 0.12)) : 16
            let words = short ? max(10, min(40, g.size.height * 0.5)) : max(23, min(40, s * 0.12))
            VStack(spacing: s * 0.05) {
                if !short && g.size.height >= 220 {
                    Image(systemName: DesignWidgets.symbol(kind)).font(.system(size: max(22, s * 0.16), weight: .light))
                }
                Text(DesignNotHere.title(kind))
                    .font(HomeFont.inter(words, .semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(short ? 1 : (g.size.width < 200 ? 3 : 2))
                    .minimumScaleFactor(0.5)
                // the line only where it can be read; a small box has the title alone
                if g.size.height >= 160 && g.size.width >= 240 {
                    Text(DesignNotHere.line)
                        .font(HomeFont.inter(max(20, words * 0.7)))
                        .opacity(0.72)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.5)
                }
            }
            .foregroundStyle(ink)
            .padding(pad)
            .frame(width: g.size.width, height: g.size.height)
            .clipped()
        }
        .modifier(DesignPanel(panel: panel, look: look, style: style, radius: DesignLayout.corner(style.corners, w: 400, h: 400), kind: kind))
    }
}

/// The card for a kind drawn here that has no live data yet: its symbol and its name, nothing more.
struct DesignTitledCard: View {
    let kind: String
    let label: String?
    let look: DesignLook
    let style: DesignWidgetStyle

    var body: some View {
        let p = DesignWidgets.panel(kind, style)
        let panel = p == "none" ? "glass" : p
        let ink = DesignInk.colour(style: style, panel: panel, look: look, kind: kind)
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            // a short box (a 40 px pill) has room for one line of words only: no icon, less padding,
            // words no taller than the box, so nothing spills out of it
            let short = g.size.height < 110
            let pad = short ? max(2, min(16, g.size.height * 0.12)) : 16
            let words = short ? max(10, min(40, g.size.height * 0.5)) : max(23, min(40, s * 0.12))
            VStack(spacing: s * 0.07) {
                if !short {
                    Image(systemName: DesignWidgets.symbol(kind)).font(.system(size: max(22, s * 0.2), weight: .light))
                }
                Text(label.flatMap { $0.isEmpty ? nil : $0 } ?? DesignWidgets.title(kind))
                    .font(HomeFont.inter(words, .semibold))
                    .multilineTextAlignment(.center)
                    .lineLimit(short ? 1 : 2)
                    .minimumScaleFactor(0.5)
            }
            .foregroundStyle(ink)
            .padding(pad)
            .frame(width: g.size.width, height: g.size.height)
            .clipped()
        }
        .modifier(DesignPanel(panel: panel, look: look, style: style, radius: DesignLayout.corner(style.corners, w: 400, h: 400), kind: kind))
    }
}

enum DesignInk {
    static func colour(style: DesignWidgetStyle, panel: String, look: DesignLook, kind: String = "") -> Color {
        let dark = Color(red: 0.11, green: 0.105, blue: 0.094)
        switch style.ink {
        case "white": return .white
        case "ink": return DesignPaint.colour(look.ink) ?? dark
        case "accent": return DesignPaint.colour(style.accent) ?? DesignPaint.colour(look.accent) ?? .white
        default:
            if let f = DesignWidgets.fill(panel: panel, kind: kind, style: style, look: look) { return DesignWidgets.light(f) ? dark : .white }
            return DesignPaint.colour(look.ink) ?? .white
        }
    }

    static func sub(style: DesignWidgetStyle, panel: String, look: DesignLook, kind: String = "") -> Color {
        if style.ink == nil || style.ink == "auto", panel == "glass" || panel == "none", let s = DesignPaint.colour(look.sub) { return s }
        return colour(style: style, panel: panel, look: look, kind: kind).opacity(0.72)
    }
}

// MARK: - the apps

extension HomeModel {
    /// The apps a design names (couch-tv's catalogue ids like "netflix", or bundle ids), found among this
    /// Apple TV's apps. An app this Apple TV does not have is left out.
    func designApps(_ ids: [String]) -> [DockApp] {
        func plain(_ s: String) -> String { s.lowercased().filter { $0.isLetter || $0.isNumber } }
        var out: [DockApp] = []
        for id in ids {
            let p = plain(id)
            let hit = apps.first { $0.id == id || $0.package == id } ??
                apps.first { !p.isEmpty && (plain($0.title).contains(p) || plain($0.package ?? "").contains(p)) }
            if let hit, !out.contains(hit) { out.append(hit) }
        }
        return out
    }
}

/// One app tile with the home's focus: a white ring, the tile growing, its name below when focused.
struct DesignAppTile: View {
    @EnvironmentObject var model: HomeModel
    let app: DockApp
    var size: Double = 112
    var labels = "focus"
    var shape = "rounded"
    var focus: FocusState<HomeFocus?>.Binding

    var body: some View {
        Button { model.open(app) } label: {
            Focused(tag: "app:" + app.id) { f in
                VStack(spacing: 10) {
                    AppFace(app: app, size: size)
                        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: corner + 4, style: .continuous).strokeBorder(.white, lineWidth: f ? 4 : 0).padding(-4))
                        .shadow(color: .black.opacity(f ? 0.4 : 0.2), radius: f ? 20 : 8, y: f ? 18 : 6)
                    if labels == "always" {
                        Text(app.title).font(HomeFont.inter(20, .semibold)).foregroundStyle(.white).lineLimit(1).frame(width: size + 30)
                    }
                }
                .overlay(alignment: .bottom) {
                    if labels == "focus" {
                        Text(app.title).font(HomeFont.inter(20, .semibold)).foregroundStyle(.white).lineLimit(1).fixedSize()
                            .shadow(color: .black.opacity(0.5), radius: 6).offset(y: 38).opacity(f ? 1 : 0)
                    }
                }
                .scaleEffect(f ? 1.14 : 1)
                .animation(.easeOut(duration: 0.24), value: f)
            }
        }
        .buttonStyle(BareButton())
        .focused(focus, equals: .app(app.id))
    }

    private var corner: Double {
        switch shape {
        case "square": return size * 0.08
        case "circle": return size / 2
        case "squircle": return size * 0.34
        case "none": return 0
        default: return size * 0.225
        }
    }
}

struct DesignTool: View {
    let symbol: String
    let tag: String
    let name: String
    let focusAs: HomeFocus
    var focus: FocusState<HomeFocus?>.Binding
    var size: Double = 96
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Focused(tag: tag) { f in
                ToolFace(symbol: symbol, size: size)
                    .overlay(RoundedRectangle(cornerRadius: size * 0.225 + 4, style: .continuous).strokeBorder(.white, lineWidth: f ? 4 : 0).padding(-4))
                    .overlay(alignment: .bottom) {
                        Text(name).font(HomeFont.inter(20, .semibold)).foregroundStyle(.white).fixedSize()
                            .shadow(color: .black.opacity(0.5), radius: 6).offset(y: 38).opacity(f ? 1 : 0)
                    }
                    .scaleEffect(f ? 1.14 : 1)
                    .animation(.easeOut(duration: 0.24), value: f)
            }
        }
        .buttonStyle(BareButton())
        .focused(focus, equals: focusAs)
    }
}

/// The dock, the way the design shapes it: a row, a column or a grid, its icons' size, gap and shape.
struct DesignDock: View {
    @EnvironmentObject var model: HomeModel
    let design: Design
    let part: DesignPart
    var focus: FocusState<HomeFocus?>.Binding

    var body: some View {
        let size = part.iconSize ?? 112, gap = part.iconGap ?? 26
        let ids = design.order(model.apps.map(\.id))
        let limit = min(part.maxApps ?? 10, design.home.dockSize ?? model.prefs.dockMax, model.dockLine)
        let apps = ids.compactMap { id in model.apps.first { $0.id == id } }.prefix(limit)
        let cols: Int = {
            switch part.layout {
            case "column": return 1
            case "grid": return max(1, part.columns ?? 3)
            default: return max(1, min(apps.count + 2, Int((1728 - 56 + gap) / (size + gap))))
            }
        }()
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(size), spacing: gap), count: cols), spacing: gap + (part.labels == "always" ? 30 : 0)) {
            ForEach(Array(apps)) { app in
                DesignAppTile(app: app, size: size, labels: part.labels ?? "focus", shape: part.iconShape ?? "rounded", focus: focus)
            }
            DesignTool(symbol: "gearshape", tag: "settings", name: "Settings", focusAs: .settings, focus: focus, size: size) { model.openSettings() }
            if !model.apps.isEmpty {
                DesignTool(symbol: "ellipsis", tag: "more", name: "More apps", focusAs: .more, focus: focus, size: size) { model.openMore() }
            }
        }
        .fixedSize()
        .padding(.vertical, 22)
        .padding(.horizontal, 28)
        .modifier(DesignPanel(panel: part.panel ?? "glass", look: design.look, style: DesignWidgetStyle(), radius: 46))
        .focusSection()
    }
}

struct DesignPeople: View {
    @EnvironmentObject var model: HomeModel
    let panel: String
    var focus: FocusState<HomeFocus?>.Binding

    var body: some View {
        HStack(spacing: 8) {
            ForEach(model.people.prefix(6)) { p in
                Button { model.choose(p) } label: {
                    Focused(tag: "person:" + p.id) { f in
                        let on = p.id == model.who
                        Text(p.name)
                            .font(HomeFont.inter(23, .semibold))
                            .padding(.horizontal, 20)
                            .frame(height: 36)
                            .foregroundStyle(on ? Color(white: 0.07) : (f ? .white : .white.opacity(0.78)))
                            .background(Capsule().fill(on ? Color.white : (f ? Color.white.opacity(0.16) : .clear)))
                            .overlay(Capsule().strokeBorder(.white, lineWidth: f ? 3 : 0).padding(-3))
                            .scaleEffect(f ? 1.08 : 1)
                            .animation(.easeOut(duration: 0.2), value: f)
                    }
                }
                .buttonStyle(BareButton())
                .focused(focus, equals: .person(p.id))
            }
        }
        .padding(6)
        .modifier(DesignPanel(panel: panel, look: DesignLook(), style: DesignWidgetStyle(), radius: 32))
        .fixedSize()
        .focusSection()
    }
}

/// The quick buttons an Apple TV can do: the sleep timer (with the bridge), and Settings.
struct DesignQuick: View {
    @EnvironmentObject var model: HomeModel
    let ids: [String]
    var settings = true                 // the gear, unless the dock already has it
    var focus: FocusState<HomeFocus?>.Binding

    var body: some View {
        HStack(spacing: 16) {
            if ids.contains("sleep") && model.connected {
                Button { model.nextSleep() } label: {
                    Focused(tag: "sleep") { f in
                        HStack(spacing: 10) {
                            Image(systemName: "moon").font(.system(size: 34, weight: .light))
                            if let ends = model.sleepEnds, ends > Date() {
                                Text("\(max(1, Int(ends.timeIntervalSinceNow / 60))) min").font(HomeFont.inter(23, .semibold))
                            }
                        }
                        .foregroundStyle(f ? Color(white: 0.07) : .white)
                        .padding(.horizontal, 26)
                        .frame(minWidth: 88, minHeight: 88)
                        .background(Capsule().fill(f ? Color.white : .clear))
                        .glass(44)
                        .scaleEffect(f ? 1.08 : 1)
                    }
                }
                .buttonStyle(BareButton())
                .focused(focus, equals: .sleep)
            }
            if settings { Button { model.openSettings() } label: {
                Focused(tag: "settings") { f in
                    Image(systemName: "gearshape").font(.system(size: 34, weight: .light))
                        .foregroundStyle(f ? Color(white: 0.07) : .white)
                        .frame(width: 88, height: 88)
                        .background(Circle().fill(f ? Color.white : .clear))
                        .glass(44)
                        .scaleEffect(f ? 1.08 : 1)
                }
            }
            .buttonStyle(BareButton())
            .focused(focus, equals: .settings) }
        }
        .fixedSize()
        .focusSection()
    }
}

// MARK: - widgets

struct DesignWidget: View {
    @EnvironmentObject var model: HomeModel
    @Environment(\.designClock24) private var c24
    let design: Design
    let widget: DesignObject
    let date: Date
    var focus: FocusState<HomeFocus?>.Binding


    var body: some View {
        let o = widget
        let kind = o.kind ?? "card"
        if kind == "stack" {
            DesignWidget(design: design, widget: stackChild(o), date: date, focus: focus)
        } else if !DesignWidgets.drawsNatively(kind) {
            DesignNotHereCard(kind: kind, look: design.look, style: o.widgetStyle)
        } else if !hasData(kind) {
            DesignTitledCard(kind: kind, label: o.opts.label, look: design.look, style: o.widgetStyle)
        } else {
            let panel = DesignWidgets.panel(kind, o.widgetStyle)
            let ink = DesignInk.colour(style: o.widgetStyle, panel: panel, look: design.look, kind: kind)
            let sub = DesignInk.sub(style: o.widgetStyle, panel: panel, look: design.look, kind: kind)
            let w = o.w ?? 360, h = o.h ?? 360
            content(kind, w: w, h: h, ink: ink, sub: sub)
                .frame(width: w, height: h)
                .foregroundStyle(ink)
                .modifier(DesignPanel(panel: panel, look: design.look, style: o.widgetStyle, radius: DesignLayout.corner(o.widgetStyle.corners, w: w, h: h), kind: kind))
        }
    }

    /// A smart stack's widget on show now: they take turns every `turn` seconds (the first, with no turn).
    private func stackChild(_ o: DesignObject) -> DesignObject {
        let i = o.turn > 0 ? Int(date.timeIntervalSince1970 / Double(o.turn)) % max(1, o.items.count) : 0
        var child = o.items[min(i, o.items.count - 1)]
        child.w = o.w
        child.h = o.h
        return child
    }

    /// A kind that needs the Apple TV's own data draws its card until it has it.
    private func hasData(_ kind: String) -> Bool {
        switch kind {
        case "weather", "bigtemp": return model.weather != nil
        case "keep", "keeprow": return !model.items.isEmpty
        case "people": return model.people.count > 1
        case "app", "folder", "appgrid", "games": return !model.apps.isEmpty
        case "photo", "artframe": return widget.opts.image.flatMap(DesignPictures.image) != nil
        case "worldclock": return !widget.opts.cities.isEmpty
        case "countdown": return widget.opts.month != nil && widget.opts.day != nil
        case "card": return !(widget.opts.text ?? widget.opts.label ?? "").isEmpty
        case "quote": return !(widget.opts.text ?? "").isEmpty
        default: return true
        }
    }

    private var clock24: Bool { widget.opts.format.map { $0 == "24h" } ?? c24 }

    private func frameAlign(_ a: String?) -> Alignment { a == "left" ? .leading : a == "right" ? .trailing : .center }
    private func textAlign(_ a: String?) -> TextAlignment { a == "left" ? .leading : a == "right" ? .trailing : .center }
    private func stackAlign(_ a: String?) -> HorizontalAlignment { a == "left" ? .leading : a == "right" ? .trailing : .center }

    @ViewBuilder
    private func content(_ kind: String, w: Double, h: Double, ink: Color, sub: Color) -> some View {
        let o = widget.opts
        switch kind {
        case "clock", "tallclock", "glassclock":
            let t = DesignDates.time(date, clock24: clock24)
            VStack(alignment: stackAlign(o.align), spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(t).font(kind == "clock" ? HomeFont.inter(h * 0.62, .semibold) : .custom("CouchAntonio-Light", fixedSize: h * 0.9))
                        .lineLimit(1).minimumScaleFactor(0.2)
                    if o.ampm == true && !clock24 { Text(DesignDates.ampm(date)).font(HomeFont.inter(h * 0.16, .medium)).foregroundStyle(sub) }
                }
                .opacity(kind == "glassclock" ? 0.86 : 1)
                if o.date == true { Text(DesignDates.text(date, format: nil)).font(HomeFont.inter(max(23, h * 0.13))).foregroundStyle(sub) }
            }
            .shadow(color: .black.opacity(0.3), radius: 18, y: 6)
            .frame(width: w, height: h, alignment: frameAlign(o.align))
        case "flipclock":
            let t = DesignDates.time(date, clock24: clock24).replacingOccurrences(of: ":", with: "")
            HStack(spacing: w * 0.02) {
                ForEach(Array(t.enumerated()), id: \.offset) { i, ch in
                    Text(String(ch)).font(HomeFont.inter(h * 0.6, .semibold)).foregroundStyle(.white)
                        .frame(width: w * 0.2, height: h * 0.86)
                        .background(RoundedRectangle(cornerRadius: h * 0.08).fill(Color(white: 0.1)))
                        .overlay(Rectangle().fill(Color.black.opacity(0.5)).frame(height: 2))
                        .padding(.leading, i == t.count - 2 ? w * 0.04 : 0)
                }
            }
        case "analog":
            DesignAnalog(date: date, seconds: o.seconds == true, ink: ink).padding(min(w, h) * 0.08)
        case "wordclock":
            Text(DesignDates.words(date)).font(HomeFont.inter(min(h * 0.2, w * 0.11), .semibold))
                .multilineTextAlignment(.center).minimumScaleFactor(0.4).padding(24)
        case "worldclock":
            VStack(alignment: .leading, spacing: 10) {
                if let l = o.label, !l.isEmpty { Text(l).font(HomeFont.inter(24, .semibold)).foregroundStyle(sub) }
                ForEach(o.cities, id: \.self) { tz in
                    HStack {
                        Text(tz.split(separator: "/").last.map { $0.replacingOccurrences(of: "_", with: " ") } ?? tz).font(HomeFont.inter(28, .medium))
                        Spacer()
                        Text(worldTime(tz)).font(HomeFont.inter(32, .semibold)).monospacedDigit()
                    }
                }
            }
            .padding(28)
        case "countdown":
            let days = DesignDates.daysUntil(month: o.month ?? 12, day: o.day ?? 25, from: date)
            let unit = o.unit ?? "days"
            let n = unit == "weeks" ? Int((Double(days) / 7).rounded(.up)) : days
            let word = unit == "sleeps" ? (n == 1 ? "sleep" : "sleeps") : unit == "weeks" ? (n == 1 ? "week" : "weeks") : (n == 1 ? "day" : "days")
            VStack(spacing: 4) {
                Text("\(n)").font(HomeFont.inter(min(h * 0.42, w * 0.4), .semibold)).minimumScaleFactor(0.3).lineLimit(1)
                Text(word + ((o.label ?? "").isEmpty ? "" : " until " + (o.label ?? ""))).font(HomeFont.inter(max(23, h * 0.09), .medium))
                    .foregroundStyle(sub).multilineTextAlignment(.center).lineLimit(2)
            }
            .padding(20)
        case "date":
            VStack(alignment: stackAlign(o.align), spacing: 6) {
                if o.show != "weather" {
                    Text(DesignDates.text(date, format: o.dfmt)).font(HomeFont.inter(min(h * 0.5, 48), .medium)).lineLimit(1).minimumScaleFactor(0.4)
                }
                if o.show == "weather" || o.show == "both", let wx = model.weather {
                    HStack(spacing: 8) {
                        Image(systemName: HomeModel.weatherSymbol(wx))
                        Text(model.tempText(wx) + " " + (wx.text ?? HomeModel.weatherWords(wx.code)))
                    }
                    .font(HomeFont.inter(min(h * 0.4, 34)))
                }
            }
            .shadow(color: .black.opacity(0.3), radius: 12, y: 2)
            .frame(width: w, height: h, alignment: frameAlign(o.align))
        case "month":
            DesignMonth(date: date, ink: ink, sub: sub).padding(min(w, h) * 0.07)
        case "weather", "bigtemp":
            if let wx = model.weather {
                let words = wx.text ?? HomeModel.weatherWords(wx.code)
                if kind == "bigtemp" || h > w * 0.8 {
                    VStack(spacing: h * 0.03) {
                        Image(systemName: HomeModel.weatherSymbol(wx)).font(.system(size: min(w, h) * 0.2, weight: .light))
                        Text(model.tempText(wx)).font(HomeFont.inter(min(w, h) * 0.32, .semibold)).lineLimit(1).minimumScaleFactor(0.3)
                        Text(words).font(HomeFont.inter(max(23, min(w, h) * 0.08))).foregroundStyle(sub)
                    }
                    .padding(16)
                } else {
                    HStack(spacing: w * 0.05) {
                        Image(systemName: HomeModel.weatherSymbol(wx)).font(.system(size: h * 0.42, weight: .light))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.tempText(wx)).font(HomeFont.inter(h * 0.38, .semibold)).lineLimit(1).minimumScaleFactor(0.3)
                            Text(words).font(HomeFont.inter(max(23, h * 0.13))).foregroundStyle(sub).lineLimit(1)
                        }
                    }
                    .padding(20)
                }
            }
        case "photo", "artframe":
            if let src = o.image, let img = DesignPictures.image(src) {
                let mat = kind == "artframe" ? min(w, h) * 0.07 : 0
                ZStack {
                    if kind == "artframe" { (DesignPaint.colour(o.mat) ?? Color(red: 0.97, green: 0.96, blue: 0.93)) }
                    Group {
                        if o.fit == "contain" { Image(platform: img).resizable().scaledToFit() } else { Image(platform: img).resizable().scaledToFill() }
                    }
                    .frame(width: w - mat * 2, height: h - mat * 2 - (o.caption == nil ? 0 : 0))
                    .clipped()
                    if let c = o.caption, !c.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c).font(HomeFont.inter(26, .semibold))
                            if let s = o.sub, !s.isEmpty { Text(s).font(HomeFont.inter(23)).opacity(0.8) }
                        }
                        .foregroundStyle(.white).shadow(color: .black.opacity(0.6), radius: 8)
                        .padding(mat + 18)
                        .frame(width: w, height: h, alignment: .bottomLeading)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: kind == "artframe" ? 6 : 24, style: .continuous))
            }
        case "keep":
            if let item = model.items.first { keepCard(item, w: w, h: h) }
        case "keeprow":
            VStack(alignment: .leading, spacing: 14) {
                Text(o.label.flatMap { $0.isEmpty ? nil : $0 } ?? "Keep watching").font(HomeFont.inter(25, .semibold)).foregroundStyle(sub)
                HStack(spacing: 18) {
                    ForEach(model.items.prefix(o.shows ?? 3)) { item in keepCard(item, w: min(520, (w - 36) / Double(min(o.shows ?? 3, model.items.count))), h: h - 50) }
                }
            }
            .frame(width: w, height: h, alignment: .topLeading)
        case "app":
            if let app = (model.designApps(o.apps).first ?? model.dockApps.first) {
                DesignAppTile(app: app, size: min(w, h) * 0.8, labels: "focus", focus: focus).frame(width: w, height: h)
            }
        case "dock":
            let named = model.designApps(o.apps)
            let list = Array((named.isEmpty ? model.dockApps : named).prefix(10))
            let n = Double(list.count + (o.more == false ? 1 : 2))
            let size = max(40, min(h - 44, (w - 56 - 22 * (n - 1)) / n))
            HStack(spacing: 22) {
                ForEach(list) { app in DesignAppTile(app: app, size: size, focus: focus) }
                DesignTool(symbol: "gearshape", tag: "settings", name: "Settings", focusAs: .settings, focus: focus, size: size) { model.openSettings() }
                if o.more != false {
                    DesignTool(symbol: "ellipsis", tag: "more", name: "More apps", focusAs: .more, focus: focus, size: size) { model.openMore() }
                }
            }
            .frame(width: w, height: h)
            .focusSection()
        case "folder", "games", "appgrid":
            let named = model.designApps(o.apps)
            let list = Array((named.isEmpty ? model.dockApps : named).prefix(16))
            let cols = o.cols ?? 3
            let label = kind == "appgrid" ? nil : (o.label.flatMap { $0.isEmpty ? nil : $0 } ?? (kind == "games" ? "Games" : nil))
            let names = kind == "appgrid" && o.names == true
            let rows = max(1, Int((Double(list.count) / Double(cols)).rounded(.up)))
            let top = label == nil ? 0.0 : 44
            let gap = 22.0
            let size = max(40, min((w - 40 - gap * Double(cols - 1)) / Double(cols), (h - 40 - top - gap * Double(rows - 1) - (names ? Double(rows) * 30 : 0)) / Double(rows)))
            VStack(alignment: .leading, spacing: 12) {
                if let label { Text(label).font(HomeFont.inter(26, .semibold)).foregroundStyle(sub) }
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(size), spacing: gap), count: cols), spacing: gap) {
                    ForEach(list) { app in DesignAppTile(app: app, size: size, labels: names ? "always" : "focus", focus: focus) }
                }
                .fixedSize()
            }
            .padding(20)
            .frame(width: w, height: h)
            .focusSection()
        case "people":
            DesignPeople(panel: "none", focus: focus).frame(width: w, height: h)
        case "quick":
            DesignQuick(ids: o.quick.isEmpty ? ["sleep"] : o.quick, focus: focus).frame(width: w, height: h, alignment: frameAlign(o.align))
        case "card":
            VStack(alignment: .leading, spacing: 10) {
                if let i = o.icon { Image(systemName: symbol(i)).font(.system(size: 34, weight: .light)).foregroundStyle(sub) }
                if let l = o.label, !l.isEmpty { Text(l).font(HomeFont.inter(26, .semibold)).foregroundStyle(sub) }
                if let t = o.text, !t.isEmpty { Text(t).font(HomeFont.inter(min(44, max(26, h * 0.12)), .medium)).minimumScaleFactor(0.5) }
            }
            .padding(28)
            .frame(width: w, height: h, alignment: .topLeading)
        case "quote":
            VStack(spacing: 14) {
                Text("\u{201C}" + (o.text ?? "") + "\u{201D}").font(.system(size: min(52, max(28, h * 0.14)), weight: .regular, design: .serif))
                    .multilineTextAlignment(.center).minimumScaleFactor(0.4)
                if let s = o.sub, !s.isEmpty { Text(s).font(HomeFont.inter(24, .medium)).foregroundStyle(sub) }
            }
            .shadow(color: .black.opacity(0.25), radius: 10, y: 2)
            .padding(24)
        case "welcome":
            VStack(alignment: stackAlign(o.align), spacing: 8) {
                if let k = DesignWelcomeSample.line(o.kicker), !k.isEmpty { Text(k.uppercased()).kerning(2).font(HomeFont.inter(24, .semibold)).foregroundStyle(sub) }
                Text(DesignWelcomeSample.greeting(o.text).flatMap { $0.isEmpty ? nil : $0 } ?? "Welcome").font(HomeFont.inter(min(96, max(40, h * 0.3)), .semibold))
                    .multilineTextAlignment(textAlign(o.align)).minimumScaleFactor(0.4)
                if let s = DesignWelcomeSample.line(o.sub), !s.isEmpty { Text(s).font(HomeFont.inter(28)).foregroundStyle(sub).multilineTextAlignment(textAlign(o.align)) }
            }
            .shadow(color: .black.opacity(0.3), radius: 14, y: 2)
            .frame(width: w, height: h, alignment: frameAlign(o.align))
        default:
            DesignTitledCard(kind: kind, label: o.label, look: design.look, style: widget.widgetStyle)
        }
    }

    private func worldTime(_ tz: String) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz) ?? .current
        return DesignDates.time(date, clock24: clock24, calendar: cal)
    }

    private func symbol(_ icon: String) -> String {
        ["heart": "heart", "star": "star", "home": "house", "gift": "gift", "cake": "birthday.cake", "plane": "airplane",
         "sun": "sun.max", "moon": "moon", "music": "music.note", "book": "book", "bell": "bell", "leaf": "leaf"][icon] ?? "sparkles"
    }

    private func keepCard(_ item: ContinueItem, w: Double, h: Double) -> some View {
        Button { model.resume(item) } label: {
            Focused(tag: "card:" + item.id) { f in
                ZStack(alignment: .bottomLeading) {
                    Color.white.opacity(0.08)
                    if let img = model.posters[item.id] { Image(platform: img).resizable().scaledToFill() }
                    LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title).font(HomeFont.inter(28, .semibold)).lineLimit(1)
                        if !item.episodeLine.isEmpty { Text(item.episodeLine).font(HomeFont.inter(23)).opacity(0.8) }
                        if let p = item.progress {
                            Capsule().fill(Color.white.opacity(0.25)).frame(height: 5)
                                .overlay(alignment: .leading) { Capsule().fill(Color.white).frame(width: max(0, (w - 40) * min(1, max(0, p))), height: 5) }
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(20)
                }
                .frame(width: w, height: h)
                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 29, style: .continuous).strokeBorder(.white, lineWidth: f ? 3 : 0).padding(-3))
                .scaleEffect(f ? 1.04 : 1)
                .animation(.easeOut(duration: 0.24), value: f)
            }
        }
        .buttonStyle(BareButton())
        .focused(focus, equals: .card(item.id))
    }
}

/// A clock face with hands.
struct DesignAnalog: View {
    let date: Date
    let seconds: Bool
    let ink: Color

    var body: some View {
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            let c = Calendar.current.dateComponents([.hour, .minute, .second], from: date)
            let m = Double(c.minute ?? 0), hr = Double((c.hour ?? 0) % 12) + m / 60, sec = Double(c.second ?? 0)
            ZStack {
                ForEach(0..<12, id: \.self) { i in
                    Capsule().fill(ink.opacity(i % 3 == 0 ? 0.9 : 0.45))
                        .frame(width: s * (i % 3 == 0 ? 0.022 : 0.012), height: s * 0.07)
                        .offset(y: -s * 0.43)
                        .rotationEffect(.degrees(Double(i) * 30))
                }
                hand(width: s * 0.04, length: s * 0.26, angle: hr * 30)
                hand(width: s * 0.026, length: s * 0.38, angle: m * 6)
                if seconds { hand(width: s * 0.008, length: s * 0.4, angle: sec * 6, colour: Color(red: 1, green: 0.42, blue: 0.2)) }
                Circle().fill(ink).frame(width: s * 0.05, height: s * 0.05)
            }
            .frame(width: g.size.width, height: g.size.height)
        }
    }

    private func hand(width: Double, length: Double, angle: Double, colour: Color? = nil) -> some View {
        Capsule().fill(colour ?? ink)
            .frame(width: width, height: length)
            .offset(y: -length / 2)
            .rotationEffect(.degrees(angle))
    }
}

/// This month as a small calendar, today ringed.
struct DesignMonth: View {
    let date: Date
    let ink: Color
    let sub: Color

    var body: some View {
        let cal = Calendar(identifier: .gregorian)
        let comps = cal.dateComponents([.year, .month, .day], from: date)
        let first = cal.date(from: DateComponents(year: comps.year, month: comps.month, day: 1)) ?? date
        let days = cal.range(of: .day, in: .month, for: first)?.count ?? 30
        let lead = (cal.component(.weekday, from: first) + 5) % 7          // weeks start on Monday
        let cells: [Int] = Array(repeating: 0, count: lead) + Array(1...days)
        let f: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_AU"); f.dateFormat = "MMMM"; return f }()
        GeometryReader { g in
            let cw = g.size.width / 7
            let ch = (g.size.height - 70) / 7
            VStack(alignment: .leading, spacing: 0) {
                Text(f.string(from: date)).font(HomeFont.inter(min(36, ch * 0.9), .semibold)).frame(height: 50, alignment: .leading)
                HStack(spacing: 0) {
                    ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, d in
                        Text(d).font(HomeFont.inter(min(23, ch * 0.6), .medium)).foregroundStyle(sub).frame(width: cw, height: ch)
                    }
                }
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(cw), spacing: 0), count: 7), spacing: 0) {
                    ForEach(Array(cells.enumerated()), id: \.offset) { _, n in
                        Text(n == 0 ? "" : "\(n)")
                            .font(HomeFont.inter(min(24, ch * 0.6), n == comps.day ? .semibold : .regular))
                            .foregroundStyle(n == comps.day ? Color.black : ink)
                            .frame(width: min(cw, ch) * 0.9, height: min(cw, ch) * 0.9)
                            .background(Circle().fill(n == comps.day ? Color.white : .clear))
                            .frame(width: cw, height: ch)
                    }
                }
            }
        }
    }
}

// MARK: - "Use this design?"

/// A design got by code is shown small first, and only Yes uses it (design-code.js: the question always comes first).
struct DesignAskView: View {
    @EnvironmentObject var model: HomeModel
    let design: Design
    var now: Date? = nil
    @FocusState private var choice: Int?

    var body: some View {
        ZStack {
            Color(white: 0.05)
            VStack(spacing: 40) {
                Text("A new home design arrived. Use this design?")
                    .font(HomeFont.inter(48, .semibold)).foregroundStyle(.white)
                DesignHomeView(design: design, now: now, interactive: false)
                    .frame(width: 960, height: 540)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Color.white.opacity(0.3), lineWidth: 2))
                    .disabled(true)
                    .focusable(false)
                HStack(spacing: 32) {
                    answer("Yes", tag: "ask:yes", id: 1) { model.useDesign(true) }
                    answer("No", tag: "ask:no", id: 0) { model.useDesign(false) }
                }
                .focusSection()
            }
        }
        .frame(width: 1920, height: 1080)
        .ignoresSafeArea()
        .defaultFocus($choice, 0)
        .onExitCommand { model.useDesign(false) }
    }

    private func answer(_ title: String, tag: String, id: Int, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Focused(tag: tag) { f in
                Text(title)
                    .font(HomeFont.inter(30, .semibold))
                    .foregroundStyle(f ? Color(white: 0.07) : .white)
                    .frame(width: 240, height: 76)
                    .background(Capsule().fill(f ? Color.white : Color.white.opacity(0.12)))
                    .scaleEffect(f ? 1.06 : 1)
                    .animation(.easeOut(duration: 0.2), value: f)
            }
        }
        .buttonStyle(BareButton())
        .focused($choice, equals: id)
    }
}
