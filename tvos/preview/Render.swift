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
            print("usage: render <repo folder> <bridge address> <code or key> <out folder>")
            exit(2)
        }
        let root = URL(fileURLWithPath: args[1])
        Pictures.folders = ["tv-home/web/backgrounds", "remote/src/app-logos", "tvos/CouchTV/Fonts"]
            .map { root.appendingPathComponent($0) }
        Pictures.registerFonts()
        let out = URL(fileURLWithPath: args[4])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

        let model = HomeModel(link: nil, offline: true)
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
}
