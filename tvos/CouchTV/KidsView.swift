// Kids mode on an Apple TV (docs/APPLE-TV.md, "Kids mode"): while a kids profile is watching, the home is
// only their shelf of show posters and the few apps a parent allowed. No dock, no More apps, no Settings,
// no people switch, no Keep watching. "Grown ups" opens the parent PIN, typed on a number pad with the Siri
// remote. Back (Menu) closes the pad, and on the shelf it goes nowhere: it never reaches Couch TV's settings.
// The same layout as the TV home's kids mode (tv-home/web/kids.js and app.css, .kids), in points on 1920x1080.
import SwiftUI

enum KidsFocus: Hashable {
    case lock
    case show(String)
    case app(String)
    case key(Int)
}

enum KidsLook {
    static let kid = Color(red: 1, green: 159 / 255, blue: 10 / 255)          // --kid
    static let text2 = Color.white.opacity(0.72)
    static let text3 = Color.white.opacity(0.5)
    static let pad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"]
}

struct KidsView: View {
    @EnvironmentObject var model: HomeModel
    @FocusState private var focus: KidsFocus?
    @Environment(\.flatGlass) private var flat
    var now: Date? = nil                         // the preview renderer fixes the time

    var body: some View {
        let shelf = model.kids
        TimelineView(.everyMinute) { tl in
            ZStack(alignment: .topLeading) {
                KidsBackdrop()
                VStack(alignment: .leading, spacing: 0) {
                    header(shelf, date: now ?? tl.date)
                        .focusSection()
                    Spacer(minLength: 0)
                    if let shows = shelf?.shows, !shows.isEmpty {
                        posters(shows).focusSection()
                    } else {
                        Text("No shows here yet. A grown up can add some from the phone remote, or in config.json.")
                            .font(HomeFont.inter(30, .medium)).foregroundStyle(KidsLook.text2)
                            .frame(width: 1100, alignment: .leading)
                    }
                    Spacer(minLength: 0)
                    if let apps = shelf?.apps, !apps.isEmpty {
                        appRow(apps).focusSection()
                    }
                }
                .padding(.horizontal, 80)
                .padding(.top, 62)
                .padding(.bottom, 60)
                .frame(width: 1920, height: 1080, alignment: .topLeading)
                .disabled(model.pin != nil)          // nothing behind the pad takes the focus
                Text(model.message)
                    .font(HomeFont.inter(24, .medium)).foregroundStyle(KidsLook.text2)
                    .opacity(model.message.isEmpty ? 0 : 1)
                    .at(80, 1030)
                if let pad = model.pin {
                    PinPadView(pad: pad, wait: model.pinWait, focus: $focus)
                }
            }
            .frame(width: 1920, height: 1080)
        }
        .ignoresSafeArea()
        .defaultFocus($focus, shelf?.shows.first.map { KidsFocus.show($0.id) } ?? .lock)
        .onExitCommand { if model.pin != nil { model.closePin() } else { focus = shelf?.shows.first.map { .show($0.id) } ?? .lock } }
        .onChange(of: model.pin == nil) { _, closed in
            focus = closed ? (shelf?.shows.first.map { .show($0.id) } ?? .lock) : .key(0)
        }
    }

    // MARK: who, the time, Grown ups

    private func header(_ shelf: KidsShelf?, date: Date) -> some View {
        let name = shelf?.name ?? ""
        return HStack(alignment: .center, spacing: 0) {
            ZStack {
                Circle().fill(KidsLook.kid)
                Text(String(name.prefix(1)).uppercased()).font(HomeFont.inter(38, .semibold)).foregroundStyle(.white)
            }
            .frame(width: 80, height: 80)
            .padding(.trailing, 24)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(name)'s shows").font(HomeFont.inter(48, .semibold)).foregroundStyle(.white)
                Text("Kids mode").font(HomeFont.inter(24)).foregroundStyle(KidsLook.text2)
            }
            Spacer()
            Text(model.timeText(date)).font(HomeFont.inter(40, .semibold)).foregroundStyle(.white)
                .monospacedDigit().padding(.trailing, 32)
            Button { model.openPin() } label: {
                Focused(tag: "kids:lock") { f in
                    HStack(spacing: 12) {
                        Image(systemName: "lock").font(.system(size: 26, weight: .regular))
                        Text("Grown ups").font(HomeFont.inter(24, .semibold))
                    }
                    .foregroundStyle(f ? Color(white: 0.07) : KidsLook.text2)
                    .padding(.leading, 20).padding(.trailing, 24).frame(height: 58)
                    .background(Capsule().fill(f ? Color.white : Color.white.opacity(0.1)))
                    .overlay(Capsule().strokeBorder(Color.white.opacity(f ? 0 : 0.16), lineWidth: 1))
                    .scaleEffect(f ? 1.06 : 1)
                    .animation(.easeOut(duration: 0.2), value: f)
                }
            }
            .buttonStyle(BareButton())
            .focused($focus, equals: .lock)
        }
        .frame(height: 84)
    }

    // MARK: the shelf

    private func posters(_ shows: [KidsShow]) -> some View {
        let row = HStack(alignment: .top, spacing: 40) {
            ForEach(shows) { s in
                Button { model.openShow(s) } label: {
                    Focused(tag: "kids:show:" + s.id) { f in KidsPoster(show: s, focused: f) }
                }
                .buttonStyle(BareButton())
                .focused($focus, equals: .show(s.id))
            }
        }
        .padding(.vertical, 50)       // room for the focused poster's ring and lift, which the scroll view would clip
        .padding(.horizontal, 80)
        return Group {
            if flat {
                row.frame(width: 1920, alignment: .leading).clipped()      // the preview renderer draws no scroll view
            } else {
                ScrollView(.horizontal, showsIndicators: false) { row }
            }
        }
        .padding(.horizontal, -80)
        .padding(.vertical, -20)
    }

    // MARK: the allowed apps

    private func appRow(_ apps: [DockApp]) -> some View {
        HStack(alignment: .top, spacing: 32) {
            ForEach(apps) { a in
                Button { model.open(a) } label: {
                    Focused(tag: "kids:app:" + a.id) { f in
                        VStack(spacing: 12) {
                            AppFace(app: a, size: 104)
                                .overlay(RoundedRectangle(cornerRadius: 104 * 0.225 + 5, style: .continuous)
                                    .strokeBorder(.white, lineWidth: f ? 5 : 0).padding(-5))
                            Text(a.title).font(HomeFont.inter(22, .medium))
                                .foregroundStyle(f ? .white : KidsLook.text2).lineLimit(1).fixedSize()
                        }
                        .frame(width: 128)
                        .scaleEffect(f ? 1.1 : 1)
                        .animation(.easeOut(duration: 0.2), value: f)
                    }
                }
                .buttonStyle(BareButton())
                .focused($focus, equals: .app(a.id))
            }
        }
    }
}

/// One big poster: the picture (or the title on a soft tile), the app's logo in the corner, then the
/// title and the episode or the app under it.
struct KidsPoster: View {
    @EnvironmentObject var model: HomeModel
    let show: KidsShow
    let focused: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                shape.fill(LinearGradient(colors: [.white.opacity(0.16), .white.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing))
                if let img = model.kidPosters[show.id] {
                    Image(platform: img).resizable().scaledToFill().frame(width: 304, height: 456).clipped()
                } else {
                    Text(show.title).font(HomeFont.inter(36, .semibold)).foregroundStyle(.white)
                        .frame(width: 256, height: 420, alignment: .bottomLeading).padding(.leading, 24)
                }
                if let logo = Pictures.logo(show.appPackage) {
                    Image(platform: logo).resizable().frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .shadow(color: .black.opacity(0.35), radius: 6, y: 4)
                        .padding(16)
                }
            }
            .frame(width: 304, height: 456)
            .clipShape(shape)
            .overlay(shape.strokeBorder(KidsLook.kid, lineWidth: focused ? 12 : 0).padding(-12))
            .overlay(shape.strokeBorder(.white, lineWidth: focused ? 6 : 0).padding(-6))
            .shadow(color: .black.opacity(focused ? 0.5 : 0.35), radius: focused ? 32 : 20, y: focused ? 32 : 20)
            Text(show.title).font(HomeFont.inter(30, .semibold)).foregroundStyle(focused ? .white : KidsLook.text2)
                .lineLimit(1).frame(width: 304, alignment: .leading).padding(.top, 20)
            if !show.subtitle.isEmpty {
                Text(show.subtitle).font(HomeFont.inter(24)).foregroundStyle(KidsLook.text3)
                    .lineLimit(1).frame(width: 304, alignment: .leading).padding(.top, 6)
            }
        }
        .scaleEffect(focused ? 1.08 : 1)
        .offset(y: focused ? -8 : 0)
        .animation(.easeOut(duration: 0.24), value: focused)
    }
}

/// The parent PIN: a number pad worked with the Siri remote (arrows and the click), the typed digits shown
/// only as dots. The right PIN moves the Apple TV to a grown up.
struct PinPadView: View {
    @EnvironmentObject var model: HomeModel
    let pad: PinPad
    let wait: Int
    var focus: FocusState<KidsFocus?>.Binding

    var body: some View {
        ZStack {
            Color(red: 6 / 255, green: 8 / 255, blue: 18 / 255).opacity(0.72)
            VStack(spacing: 0) {
                Image(systemName: "lock").font(.system(size: 44, weight: .light)).foregroundStyle(KidsLook.text2)
                    .frame(height: 48).padding(.bottom, 16)
                Text("Grown ups only").font(HomeFont.inter(36, .semibold)).foregroundStyle(.white)
                Text("Type the parent PIN to leave kids mode.").font(HomeFont.inter(22)).foregroundStyle(KidsLook.text2)
                    .padding(.top, 8)
                HStack(spacing: 16) {
                    ForEach(0..<max(4, pad.digits.count), id: \.self) { i in
                        Circle().fill(i < pad.digits.count ? Color.white : .clear)
                            .overlay(Circle().strokeBorder(Color.white.opacity(i < pad.digits.count ? 0 : 0.45), lineWidth: 3))
                            .frame(width: 20, height: 20)
                    }
                }
                .modifier(Shake(times: CGFloat(pad.wrong)))
                .animation(.easeOut(duration: 0.42), value: pad.wrong)
                .frame(height: 20)
                .padding(.top, 28).padding(.bottom, 24)
                .accessibilityLabel("\(pad.digits.count) digits typed")
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(120), spacing: 12), count: 3), spacing: 12) {
                    ForEach(Array(KidsLook.pad.enumerated()), id: \.offset) { i, k in
                        Button { model.pinKey(k) } label: {
                            Focused(tag: "kids:key:\(i)") { f in
                                ZStack {
                                    RoundedRectangle(cornerRadius: 20, style: .continuous).fill(f ? Color.white : Color.white.opacity(0.09))
                                    switch k {
                                    case "del": Image(systemName: "delete.left").font(.system(size: 32, weight: .light))
                                    case "ok": Image(systemName: "checkmark").font(.system(size: 30, weight: .regular))
                                    default: Text(k).font(HomeFont.inter(36, .semibold)).monospacedDigit()
                                    }
                                }
                                .foregroundStyle(f ? Color(white: 0.07) : (k.count > 1 ? KidsLook.text2 : .white))
                                .frame(width: 120, height: 80)
                                .scaleEffect(f ? 1.08 : 1)
                                .animation(.easeOut(duration: 0.16), value: f)
                            }
                        }
                        .buttonStyle(BareButton())
                        .focused(focus, equals: .key(i))
                    }
                }
                .frame(width: 384)
                Text(wait > 0 ? "Too many tries. Wait \(wait) seconds." : pad.message)
                    .font(HomeFont.inter(22, .medium)).foregroundStyle(Color(red: 1, green: 0.62, blue: 0.54))
                    .frame(height: 30).padding(.top, 18)
                Text("Up, down, left and right, then click. Back closes this.")
                    .font(HomeFont.inter(19)).foregroundStyle(KidsLook.text3)
                    .multilineTextAlignment(.center).padding(.top, 6)
            }
            .padding(.top, 44).padding(.bottom, 36).padding(.horizontal, 48)
            .frame(width: 544)
            .background(RoundedRectangle(cornerRadius: 40, style: .continuous)
                .fill(LinearGradient(colors: [Color(red: 42 / 255, green: 47 / 255, blue: 82 / 255), Color(red: 29 / 255, green: 33 / 255, blue: 64 / 255)],
                                     startPoint: .top, endPoint: .bottom))
                .shadow(color: .black.opacity(0.55), radius: 48, y: 40))
            .overlay(RoundedRectangle(cornerRadius: 40, style: .continuous).strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
            .focusSection()
        }
        .frame(width: 1920, height: 1080)
    }
}

/// The dots shake sideways after a wrong PIN.
struct Shake: GeometryEffect {
    var times: CGFloat
    var animatableData: CGFloat {
        get { times }
        set { times = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 12 * sin(times * .pi * 4), y: 0))
    }
}

/// The kids home's backdrop: deep blue and plum with a warm glow top left and a cool one bottom right.
struct KidsBackdrop: View {
    var body: some View {
        ZStack {
            LinearGradient(stops: [.init(color: Color(red: 27 / 255, green: 35 / 255, blue: 71 / 255), location: 0),
                                   .init(color: Color(red: 38 / 255, green: 26 / 255, blue: 69 / 255), location: 0.55),
                                   .init(color: Color(red: 19 / 255, green: 26 / 255, blue: 51 / 255), location: 1)],
                           startPoint: UnitPoint(x: 0.33, y: 0), endPoint: UnitPoint(x: 0.67, y: 1))
            RadialGradient(colors: [Color(red: 1, green: 196 / 255, blue: 92 / 255).opacity(0.22), .clear],
                           center: UnitPoint(x: 0.12, y: 0.08), startRadius: 0, endRadius: 700)
            RadialGradient(colors: [Color(red: 90 / 255, green: 160 / 255, blue: 1).opacity(0.24), .clear],
                           center: UnitPoint(x: 0.95, y: 1), startRadius: 0, endRadius: 820)
        }
        .frame(width: 1920, height: 1080)
    }
}
