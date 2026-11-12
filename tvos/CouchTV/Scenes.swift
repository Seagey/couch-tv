// The five scenes of the TV home's Night look, with the glass clock in each. The numbers come from the
// TV home's style sheet (tv-home/web/app.css, .s-<id> and .scene-<id> .date), in points on a 1920x1080
// screen, which is what tvOS gives every Apple TV. The pictures are the TV home's own
// (tv-home/web/backgrounds): the photo, a frosted copy that fills the digits, and (most) a cut-out of the
// scenery that stands in front of the clock.
import CoreText
import SwiftUI

struct SceneLook: Identifiable, Equatable {
    let id: String
    var clockTop: CGFloat = 150          // where the clock's line box starts (CSS top)
    var clockSize: CGFloat = 400         // font size
    var clockLeft: CGFloat? = nil        // nil: centred
    var dateTop: CGFloat = 96
    var dateLeft: CGFloat? = nil
    var cutout = true                    // scene-<id>-fg.webp
    var photoDim: Double = 1             // CSS brightness() under 1
    var fillBright: Double = 0           // added brightness for CSS brightness() over 1
    var fillDim: Double = 1
    var fillSaturation: Double = 1
    var fillContrast: Double = 1
    var fillOpacity: Double = 1
    var rimFill = Color.white.opacity(0.1)
    var rimStroke = Color.white.opacity(0.55)
    var sheen = true
    var shadow = Color.black.opacity(0.16)
    var shadowRadius: CGFloat = 14
    var shadowY: CGFloat = 6
    var waterline: CGFloat? = nil        // share of the height where the water starts
    var darkText = false
    var dateColour = Color.white
    var shade: [Gradient.Stop] = []

    static let all: [SceneLook] = [
        SceneLook(id: "night", photoDim: 0.86, fillBright: 0.07, fillSaturation: 1.2, fillOpacity: 0.9,
                  rimFill: Color(red: 1, green: 200 / 255, blue: 215 / 255).opacity(0.06),
                  rimStroke: Color(red: 1, green: 215 / 255, blue: 225 / 255).opacity(0.5),
                  dateColour: Color(red: 1, green: 232 / 255, blue: 238 / 255).opacity(0.92)),
        SceneLook(id: "golden", clockTop: 152, clockSize: 390, dateTop: 106),
        SceneLook(id: "water", clockTop: 268, clockSize: 420, dateTop: 216, cutout: false,
                  shadow: Color(red: 0, green: 20 / 255, blue: 40 / 255).opacity(0.35), shadowRadius: 15, shadowY: 8,
                  waterline: 0.55,
                  shade: [.init(color: Color(red: 0, green: 12 / 255, blue: 24 / 255).opacity(0.42), location: 0),
                          .init(color: Color(red: 0, green: 12 / 255, blue: 24 / 255).opacity(0.12), location: 0.4),
                          .init(color: .clear, location: 0.52),
                          .init(color: Color(red: 0, green: 20 / 255, blue: 40 / 255).opacity(0.5), location: 1)]),
        SceneLook(id: "fog", clockTop: 172, clockSize: 470, clockLeft: 96, dateTop: 116, dateLeft: 104,
                  fillDim: 0.46, fillSaturation: 0.8, fillContrast: 1.1, fillOpacity: 0.8,
                  rimFill: .clear, rimStroke: Color.white.opacity(0.6), sheen: false, shadow: .clear,
                  darkText: true, dateColour: Color(red: 22 / 255, green: 32 / 255, blue: 29 / 255)),
        SceneLook(id: "dawn", clockTop: 230, dateTop: 176,
                  shadow: Color(red: 60 / 255, green: 30 / 255, blue: 10 / 255).opacity(0.3), shadowRadius: 17, shadowY: 8,
                  shade: [.init(color: Color(red: 50 / 255, green: 28 / 255, blue: 12 / 255).opacity(0.42), location: 0),
                          .init(color: .clear, location: 0.55)]),
    ]

    static func byId(_ id: String) -> SceneLook { all.first { $0.id == id } ?? all[0] }

    var photo: String { "scene-\(id)" }
}

// MARK: - pictures from the app bundle (or a folder, for the preview renderer)

#if canImport(UIKit)
import UIKit
typealias PlatformImage = UIImage
#else
import AppKit
typealias PlatformImage = NSImage
#endif

enum Pictures {
    /// Where the scene photos, logos and fonts are. The app bundle; the preview renderer points it elsewhere.
    static var folders: [URL] = [Bundle.main.resourceURL].compactMap { $0 }
    private static var cache: [String: PlatformImage] = [:]      // scene pictures: the last few only, they are big
    private static var order: [String] = []
    private static var logos: [String: PlatformImage?] = [:]      // logos: small, all kept

    static var wantsLarge: Bool {
        #if os(tvOS)
        return UIScreen.main.scale > 1.5
        #else
        return false
        #endif
    }

    static func file(_ name: String) -> URL? {
        for f in folders {
            let u = f.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: u.path) { return u }
        }
        return nil
    }

    /// "scene-night", ".jpg": the @2x copy on a 4K Apple TV when there is one, else the 1920x1080 one.
    static func load(_ base: String, _ ext: String, large: Bool = true) -> PlatformImage? {
        let names = (large && wantsLarge ? ["\(base)@2x\(ext)"] : []) + ["\(base)\(ext)"]
        for n in names {
            if let img = cache[n] { return img }
            guard let u = file(n), let img = PlatformImage(contentsOfFile: u.path) else { continue }
            cache[n] = img
            order.append(n)
            if order.count > 9 { cache.removeValue(forKey: order.removeFirst()) }    // three scenes of three pictures
            return img
        }
        return nil
    }

    static func logo(_ package: String?) -> PlatformImage? {
        guard let package, !package.isEmpty else { return nil }
        if let known = logos[package] { return known }
        let img = file(package + ".png").flatMap { PlatformImage(contentsOfFile: $0.path) }
        logos[package] = img
        return img
    }

    static func registerFonts() {
        for f in folders {
            let urls = (try? FileManager.default.contentsOfDirectory(at: f, includingPropertiesForKeys: nil)) ?? []
            for u in urls where u.pathExtension == "ttf" {
                CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil)
            }
        }
    }
}

extension Image {
    init(platform img: PlatformImage) {
        #if canImport(UIKit)
        self.init(uiImage: img)
        #else
        self.init(nsImage: img)
        #endif
    }
}

// MARK: - the clock's digits as a shape, so they can be filled with glass and given a rim

enum ClockGlyphs {
    static let fontName = "CouchAntonio-Light"
    static let lineHeight: CGFloat = 0.82     // the web page's line-height for the clock
    static let tracking: CGFloat = -0.02      // its letter-spacing, in em

    /// The digits' outline on the 1920x1080 screen, placed the way the web page places them: the line box
    /// starts at `top`, the text is centred (or starts at `left`).
    static func path(_ text: String, size: CGFloat, top: CGFloat, left: CGFloat?, width: CGFloat = 1920) -> Path {
        let font = CTFontCreateWithName(fontName as CFString, size, nil)
        let attrs: [NSAttributedString.Key: Any] = [.init(kCTFontAttributeName as String): font,
                                                     .init(kCTKernAttributeName as String): tracking * size]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
        let ascent = CTFontGetAscent(font), descent = CTFontGetDescent(font)
        let baseline = top + (lineHeight * size - (ascent + descent)) / 2 + ascent
        let advance = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        let x0 = left ?? (width - advance) / 2
        let out = CGMutablePath()
        for run in (CTLineGetGlyphRuns(line) as? [CTRun]) ?? [] {
            let n = CTRunGetGlyphCount(run)
            var glyphs = [CGGlyph](repeating: 0, count: n)
            var points = [CGPoint](repeating: .zero, count: n)
            CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: n), &points)
            for i in 0..<n {
                var t = CGAffineTransform(translationX: x0 + points[i].x, y: baseline).scaledBy(x: 1, y: -1)
                if let g = CTFontCreatePathForGlyph(font, glyphs[i], &t) { out.addPath(g) }
            }
        }
        return Path(out)
    }
}

struct ClockShape: Shape {
    let path: Path
    func path(in rect: CGRect) -> Path { path }
}

/// The glass clock of one scene: the frosted photo seen through the digits, a thin rim, a sheen.
struct GlassClock: View {
    let look: SceneLook
    let time: String
    let glass: PlatformImage?
    var under = false                    // the water scene's reflection

    var body: some View {
        let p = ClockGlyphs.path(time, size: look.clockSize, top: look.clockTop, left: look.clockLeft)
        let shape = ClockShape(path: p)
        let box = p.boundingRect
        ZStack(alignment: .topLeading) {
            Group {
                if let glass {
                    Image(platform: glass).resizable().frame(width: 1920, height: 1080)
                } else {
                    Color.white.opacity(0.35)
                }
            }
            .brightness(look.fillBright)
            .colorMultiply(Color(white: look.fillDim))
            .saturation(under ? 1.4 : look.fillSaturation)
            .contrast(look.fillContrast)
            .hueRotation(.degrees(under ? -8 : 0))
            .opacity(look.fillOpacity)
            .mask(shape)
            shape.fill(look.rimFill)
            if look.sheen {
                LinearGradient(stops: [.init(color: .white.opacity(0.55), location: 0), .init(color: .white.opacity(0), location: 0.38),
                                       .init(color: .white.opacity(0), location: 0.7), .init(color: .white.opacity(0.22), location: 1)],
                               startPoint: UnitPoint(x: (box.minX + box.width * 0.33) / 1920, y: box.minY / 1080),
                               endPoint: UnitPoint(x: (box.minX + box.width * 0.67) / 1920, y: box.maxY / 1080))
                    .frame(width: 1920, height: 1080)
                    .mask(shape)
            }
            shape.stroke(under ? Color(red: 170 / 255, green: 240 / 255, blue: 1).opacity(0.5) : look.rimStroke, lineWidth: 1.44)
        }
        .frame(width: 1920, height: 1080, alignment: .topLeading)
        .compositingGroup()
        .shadow(color: look.shadow, radius: look.shadowRadius, x: 0, y: look.shadowY)
    }
}

/// One whole scene: photo, glass clock, the cut-out in front of it, and its shading.
struct SceneBackdrop: View {
    let look: SceneLook
    let time: String
    let late: Bool                      // after 9 pm everything dims a little, as on the TV home

    var body: some View {
        let photo = Pictures.load(look.photo, ".jpg")
        let glass = Pictures.load(look.photo + "-glass", ".jpg", large: false)
        let cut = look.cutout ? Pictures.load(look.photo + "-fg", ".webp") : nil
        let dim = look.photoDim * (late ? 0.72 : 1)
        ZStack(alignment: .topLeading) {
            Color.black
            if let photo {
                Image(platform: photo).resizable().frame(width: 1920, height: 1080).colorMultiply(Color(white: dim))
            } else {
                LinearGradient(colors: [Color(red: 0.16, green: 0.12, blue: 0.2), Color(red: 0.04, green: 0.04, blue: 0.06)],
                               startPoint: .top, endPoint: .bottom)
            }
            Group {
                if let line = look.waterline {
                    GlassClock(look: look, time: time, glass: glass)
                        .mask(Rectangle().frame(width: 1920, height: 1080 * line).frame(width: 1920, height: 1080, alignment: .top))
                    GlassClock(look: look, time: time, glass: glass, under: true)
                        .blur(radius: 2.2)
                        .opacity(0.78)
                        .offset(x: 5)
                        .mask(Rectangle().frame(width: 1920, height: 1080 * (1 - line)).frame(width: 1920, height: 1080, alignment: .bottom))
                } else {
                    GlassClock(look: look, time: time, glass: glass)
                }
            }
            .colorMultiply(Color(white: late ? 0.8 : 1))
            if let cut {
                Image(platform: cut).resizable().frame(width: 1920, height: 1080).colorMultiply(Color(white: dim))
            }
            if !look.shade.isEmpty {
                LinearGradient(stops: look.shade, startPoint: .top, endPoint: .bottom)
            }
            // the scrim under Keep watching and the dock
            LinearGradient(stops: [.init(color: .clear, location: 0.6), .init(color: .black.opacity(0.5), location: 1)],
                           startPoint: .top, endPoint: .bottom)
        }
        .frame(width: 1920, height: 1080)
        .clipped()
    }
}
