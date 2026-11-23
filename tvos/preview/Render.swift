// Draws Couch TV's screens to PNG files on a Mac, from the app's own SwiftUI views, talking to a real
// bridge (or the stand-in, tests/appletv_home_standin.py). For checking the look without an Apple TV or
// the tvOS Simulator. It is not the Simulator: no focus engine, no blur behind the glass panels, and
// focus is drawn on the tile it is told to. tvos/preview/render.sh builds and runs it.
import AppKit
import SwiftUI

@main
struct Render {
    @MainActor
    static func main() async {
        let args = CommandLine.arguments
        guard args.count >= 5 else {
            print("usage: render <repo folder> <bridge address> <code or key> <out folder>, or render <repo folder> --designs <file.json> <out folder>")
            exit(2)
        }
        let root = URL(fileURLWithPath: args[1])
        Pictures.folders = ["tv-home/web/backgrounds", "remote/src/app-logos", "tvos/CouchTV/Fonts"]
            .map { root.appendingPathComponent($0) }
        Pictures.registerFonts()
        let out = URL(fileURLWithPath: args[4])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

        let model = HomeModel(link: nil, offline: true)
        if args[2] == "--designs" {
            await designs(model: model, file: URL(fileURLWithPath: args[3]), out: out)
            return
        }
        if let why = await model.connect(address: args[2], secret: args[3]) {
            print("could not connect: \(why)")
            exit(1)
        }
        print("connected: \(model.bridge.link?.name ?? "?"), \(model.apps.count) apps, \(model.items.count) Keep watching, \(model.people.count) people, weather \(model.weather.map { model.tempText($0) } ?? "none")")

        var when = DateComponents()
        (when.year, when.month, when.day, when.hour, when.minute) = (2026, 10, 27, 8, 47)
        let now = Calendar.current.date(from: when) ?? Date()

        func shot(_ name: String, scene: String, focus: String?, _ view: some View) {
            if let i = model.scenes.firstIndex(where: { $0.id == scene }) { model.sceneIndex = i }
            let v = view.environmentObject(model).environment(\.previewFocus, focus).environment(\.flatGlass, true)
                .frame(width: 1920, height: 1080).environment(\.colorScheme, .dark)
            let r = ImageRenderer(content: v)
            r.scale = 1
            guard let cg = r.cgImage else { print("no picture for \(name)"); return }
            let rep = NSBitmapImageRep(cgImage: cg)
            let url = out.appendingPathComponent(name + ".png")
            try? rep.representation(using: .png, properties: [:])?.write(to: url)
            print("wrote \(url.path)")
        }

        if model.kidsOn, let shelf = model.kids {
            // kids mode (tests/appletv_home_standin.py --kids): the shelf, an app, and the parent PIN pad
            print("kids mode for \(shelf.name): \(shelf.shows.count) shows (\(model.kidPosters.count) posters), \(shelf.apps.count) apps")
            let second = shelf.shows.dropFirst().first ?? shelf.shows.first
            shot("kids-home", scene: "night", focus: second.map { "kids:show:" + $0.id }, KidsView(now: now))
            shot("kids-home-focus-lock", scene: "night", focus: "kids:lock", KidsView(now: now))
            model.pin = PinPad(digits: "25")
            shot("kids-pin", scene: "night", focus: "kids:key:4", KidsView(now: now))
            model.pinKey("0")
            model.pinKey("0")
            model.pinKey("ok")          // wrong: 2500
            shot("kids-pin-wrong", scene: "night", focus: "kids:key:10", KidsView(now: now))
            model.closePin()
            model.showSettings = true    // settings never open over kids mode
            print("settings over kids mode: \(model.showSettings && !model.kidsOn ? "SHOWN (wrong)" : "not shown")")
            model.openSettings()
            print("the gear asks for the PIN: \(model.pin != nil ? "yes" : "NO (wrong)")")
            model.closePin()
            if let s = shelf.shows.first { model.openShow(s) }
            if let a = model.apps.first(where: { a in !shelf.apps.contains { $0.id == a.id } }) { model.open(a) }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            print("status: \(model.message)")
            model.openPin()
            for k in ["2", "5", "8", "0"] { model.pinKey(k) }     // the right PIN: to a grown up
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            print("after the right PIN: kids mode \(model.kidsOn ? "ON (wrong)" : "off"), watching \(model.who)")
            return
        }

        let first = model.dockApps.first.map { "app:" + $0.id }
        shot("home-golden", scene: "golden", focus: first, HomeView(now: now))
        shot("home-night-focus-netflix", scene: "night", focus: "app:com.netflix.Netflix", HomeView(now: now))
        if let card = model.items.first { shot("home-water-focus-card", scene: "water", focus: "card:" + card.id, HomeView(now: now)) }
        shot("home-fog-focus-person", scene: "fog", focus: "person:person2", HomeView(now: now))
        shot("home-dawn-focus-settings", scene: "dawn", focus: "settings", HomeView(now: now))
        shot("settings", scene: "night", focus: "connect", SettingsView())
        shot("more-apps", scene: "golden", focus: "all:com.disney.disneyplus", MoreAppsView())

        // the bridge opens what the dock and Keep watching ask for (the stand-in prints it)
        if let app = model.apps.first(where: { $0.id == "com.disney.disneyplus" }) ?? model.apps.first {
            model.open(app)
        }
        if let card = model.items.first { model.resume(card) }
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        print("status: \(model.message)")
    }

    /// couch-tv Studio designs drawn by DesignView.swift, with no bridge: a file of designs (a list of
    /// {"id", "design"}, or one design), sample people, weather and apps, one PNG each.
    ///   render <repo folder> --designs <file.json> <out folder>
    @MainActor
    static func designs(model: HomeModel, file: URL, out: URL) async {
        guard let data = try? Data(contentsOf: file), let j = try? JSONSerialization.jsonObject(with: data) else {
            print("could not read \(file.path)")
            exit(1)
        }
        let list: [(String, Any)] = (j as? [[String: Any]])?.map { (($0["id"] as? String) ?? "design", $0["design"] as Any) }
            ?? [("design", j)]
        model.people = [Person(id: "person1", name: "Alex"), Person(id: "person2", name: "Sam")]
        model.who = "person1"
        model.weather = Weather(temp: 23, code: 2, isDay: true, text: nil)
        model.apps = [("com.netflix.Netflix", "Netflix", "com.netflix.ninja"), ("com.google.ios.youtube", "YouTube", "com.google.android.youtube.tv"),
                      ("com.disney.disneyplus", "Disney+", "com.disney.disneyplus"), ("au.com.stan.ios", "Stan", "au.com.stan.and"),
                      ("au.net.abc.iview", "ABC iview", "au.net.abc.iview"), ("com.spotify.client", "Spotify", "com.spotify.tv.android"),
                      ("com.amazon.aiv.AIVApp", "Prime Video", "com.amazon.amazonvideo.livingroom"), ("com.apple.TVWatchList", "Apple TV", "com.apple.atve.androidtv.appletv")]
            .map { DockApp(id: $0.0, title: $0.1, package: $0.2) }
        model.dockLine = 10
        model.items = [ContinueItem(id: "c1", title: "Bluey", season: 3, episode: 12, appName: "ABC iview", appPackage: "au.net.abc.iview", progress: 0.4),
                       ContinueItem(id: "c2", title: "The Bear", season: 2, episode: 4, appName: "Disney+", appPackage: "com.disney.disneyplus", progress: 0.7)]
        var when = DateComponents()
        (when.year, when.month, when.day, when.hour, when.minute) = (2026, 10, 27, 8, 47)
        let now = Calendar.current.date(from: when) ?? Date()
        for (id, raw) in list {
            guard let d = Design.read(raw) else { print("not a design: \(id)"); continue }
            let v = DesignHomeView(design: d, now: now).environmentObject(model).environment(\.previewFocus, model.apps.first.map { "app:" + $0.id })
                .environment(\.flatGlass, true).frame(width: 1920, height: 1080).environment(\.colorScheme, .dark)
            let r = ImageRenderer(content: v)
            r.scale = 1
            guard let cg = r.cgImage else { print("no picture for \(id)"); continue }
            let url = out.appendingPathComponent("design-\(id).png")
            try? NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])?.write(to: url)
            let native = d.objects.filter { $0.type == "widget" }.map { ($0.kind ?? "") + (DesignWidgets.drawsNatively($0.kind ?? "") ? "" : "*") }
            print("wrote \(url.path)  widgets: \(native.joined(separator: " "))")
        }
        // the question a design got by code brings, and Settings with its design rows
        if let first = list.first.flatMap({ Design.read($0.1) }) {
            for (name, view) in [("design-ask", AnyView(DesignAskView(design: first, now: now))), ("design-settings", AnyView(SettingsView()))] {
                configDesignShot(model: model, name: name, view: view, out: out)
            }
        }
    }

    @MainActor
    static func configDesignShot(model: HomeModel, name: String, view: AnyView, out: URL) {
        model.configDesign = Design()
        let v = view.environmentObject(model).environment(\.previewFocus, "ask:yes").environment(\.flatGlass, true)
            .frame(width: 1920, height: 1080).environment(\.colorScheme, .dark)
        let r = ImageRenderer(content: v)
        r.scale = 1
        guard let cg = r.cgImage else { print("no picture for \(name)"); return }
        let url = out.appendingPathComponent(name + ".png")
        try? NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])?.write(to: url)
        print("wrote \(url.path)")
    }
}
