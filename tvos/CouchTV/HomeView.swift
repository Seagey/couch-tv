// The couch-tv home on an Apple TV: the scene with its glass clock, the date and weather, the people
// switch, the sleep timer, Keep watching and the dock. Laid out on the 1920x1080 screen the same way as
// the TV home's Night look (tv-home/web/app.css).
import SwiftUI

enum HomeFocus: Hashable {
    case person(String)
    case sleep
    case card(String)
    case app(String)
    case settings
    case more
}

struct HomeView: View {
    @EnvironmentObject var model: HomeModel
    @FocusState private var focus: HomeFocus?
    @Environment(\.flatGlass) private var flat
    var now: Date? = nil                         // the preview renderer fixes the time

    var body: some View {
        TimelineView(.everyMinute) { tl in
            let date = now ?? tl.date
            let late = Calendar.current.component(.hour, from: date) >= 21 || Calendar.current.component(.hour, from: date) < 6
            ZStack(alignment: .topLeading) {
                SceneBackdrop(look: model.look, time: model.timeText(date), late: late)
                    .id(model.look.id)
                    .transition(.opacity)
                DateLine(look: model.look, date: date)
                    .id("date-" + model.look.id)
                    .transition(.opacity)
                top
                if !model.items.isEmpty { shelf }
                dock
                if !model.message.isEmpty || !model.connected { status }
            }
            .frame(width: 1920, height: 1080)
        }
        .ignoresSafeArea()
        .defaultFocus($focus, model.dockApps.first.map { HomeFocus.app($0.id) } ?? .settings)
    }

    // MARK: the people switch and the sleep timer

    private var top: some View {
        ZStack(alignment: .topLeading) {
            if model.people.count > 1 {
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
                                    .shadow(color: .black.opacity(f ? 0.35 : 0), radius: 10, y: 8)
                                    .animation(.easeOut(duration: 0.2), value: f)
                            }
                        }
                        .buttonStyle(BareButton())
                        .focused($focus, equals: .person(p.id))
                    }
                }
                .padding(6)
                .glass(32)
                .at(80, 60)
            }
            if model.connected {
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
                        .animation(.easeOut(duration: 0.2), value: f)
                    }
                }
                .buttonStyle(BareButton())
                .focused($focus, equals: .sleep)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(.trailing, 80)
                .padding(.top, 60)
            }
        }
        .focusSection()
    }

    // MARK: Keep watching

    private var shelf: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Keep watching")
                .font(HomeFont.inter(25, .semibold))
                .foregroundStyle(.white.opacity(0.78))
                .shadow(color: .black.opacity(0.4), radius: 8, y: 2)
                .frame(height: 36)
                .padding(.leading, 80)
            if flat {
                cards.frame(width: 1920, alignment: .leading).clipped()     // the preview renderer draws no scroll view
            } else {
                ScrollView(.horizontal, showsIndicators: false) { cards }.padding(.vertical, -14)
            }
        }
        .focusSection()
        .at(0, 640)
    }

    private var cards: some View {
        HStack(spacing: 22) {
            ForEach(model.items) { item in
                Button { model.resume(item) } label: {
                    Focused(tag: "card:" + item.id) { f in ContinueCard(item: item, focused: f) }
                }
                .buttonStyle(BareButton())
                .focused($focus, equals: .card(item.id))
            }
        }
        .padding(.horizontal, 80)
        .padding(.vertical, 14)
    }

    // MARK: the dock

    private var dock: some View {
        VStack {
            Spacer()
            HStack(spacing: 26) {
                ForEach(model.dockApps) { app in
                    Button { model.open(app) } label: {
                        Focused(tag: "app:" + app.id) { f in
                            AppFace(app: app)
                                .brightness(f ? 0 : -0.06)
                                .overlay(RoundedRectangle(cornerRadius: 25.2 + 4, style: .continuous)
                                    .strokeBorder(.white, lineWidth: f ? 4 : 0).padding(-4))
                                .shadow(color: .black.opacity(f ? 0.4 : 0), radius: 20, y: 18)
                                .overlay(alignment: .bottom) {
                                    Text(app.title)
                                        .font(HomeFont.inter(20, .semibold))
                                        .foregroundStyle(.white)
                                        .lineLimit(1)
                                        .fixedSize()
                                        .shadow(color: .black.opacity(0.5), radius: 6)
                                        .offset(y: 38)
                                        .opacity(f ? 1 : 0)
                                }
                                .scaleEffect(f ? 1.16 : 1)
                                .offset(y: f ? -10 : 0)
                                .animation(.easeOut(duration: 0.24), value: f)
                        }
                    }
                    .buttonStyle(BareButton())
                    .focused($focus, equals: .app(app.id))
                }
                toolTile("gearshape", tag: "settings", name: "Settings", focusAs: .settings) { model.openSettings() }
                if !model.apps.isEmpty {
                    toolTile("ellipsis", tag: "more", name: "More apps", focusAs: .more) { model.openMore() }
                }
                if model.apps.isEmpty {
                    Text(model.bridge.link == nil ? "Set up the couch-tv bridge in Settings to see your apps here."
                         : "Your apps show here once the bridge can see the Apple TV.")
                        .font(HomeFont.inter(23, .medium))
                        .foregroundStyle(.white.opacity(0.78))
                        .frame(width: 520, alignment: .leading)
                }
            }
            .padding(.vertical, 22)
            .padding(.horizontal, 28)
            .glass(46)
            .padding(.bottom, 46)
            .focusSection()
        }
        .frame(width: 1920, height: 1080)
    }

    private func toolTile(_ symbol: String, tag: String, name: String, focusAs: HomeFocus, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Focused(tag: tag) { f in
                ToolFace(symbol: symbol)
                    .shadow(color: .black.opacity(f ? 0.4 : 0), radius: 20, y: 18)
                    .overlay(RoundedRectangle(cornerRadius: 29.2, style: .continuous).strokeBorder(.white, lineWidth: f ? 4 : 0).padding(-4))
                    .overlay(alignment: .bottom) {
                        Text(name).font(HomeFont.inter(20, .semibold)).foregroundStyle(.white).fixedSize()
                            .shadow(color: .black.opacity(0.5), radius: 6).offset(y: 38).opacity(f ? 1 : 0)
                    }
                    .scaleEffect(f ? 1.16 : 1)
                    .offset(y: f ? -10 : 0)
                    .animation(.easeOut(duration: 0.24), value: f)
            }
        }
        .buttonStyle(BareButton())
        .focused($focus, equals: focusAs)
    }

    // MARK: a line of news above the dock

    private var status: some View {
        let text: String = {
            if !model.message.isEmpty { return model.message }
            switch model.state {
            case .needsCode(let why), .down(let why): return why
            case .connecting: return "Connecting to the couch-tv bridge…"
            case .notSet: return model.apps.isEmpty ? "" : "Not connected to the couch-tv bridge. Settings has the steps."
            case .connected: return ""
            }
        }()
        return Text(text)
            .font(HomeFont.inter(23, .medium))
            .foregroundStyle(.white.opacity(0.9))
            .shadow(color: .black.opacity(0.5), radius: 8, y: 2)
            .frame(width: 1920, alignment: .center)
            .opacity(text.isEmpty ? 0 : 1)
            .at(0, 842)
    }
}

/// "Tuesday 27 October", then the weather, just above each scene's clock.
struct DateLine: View {
    @EnvironmentObject var model: HomeModel
    let look: SceneLook
    let date: Date

    var body: some View {
        let colour = look.dateColour
        HStack(spacing: 0) {
            Text(model.dateText(date)).foregroundStyle(colour)
            if let w = model.weather {
                Image(systemName: HomeModel.weatherSymbol(w))
                    .font(.system(size: 28, weight: .light))
                    .padding(.leading, 16)
                    .padding(.trailing, 7)
                Text(model.tempText(w))
                let words = w.text ?? HomeModel.weatherWords(w.code)
                if !words.isEmpty { Text(" " + words).font(HomeFont.inter(34)) }
            }
        }
        .font(HomeFont.inter(34, .medium))
        .foregroundStyle(colour.opacity(0.85))
        .shadow(color: .black.opacity(look.darkText ? 0 : 0.25), radius: 9, y: 2)
        .lineLimit(1)
        .fixedSize()
        .frame(height: 40)
        .frame(width: look.dateLeft == nil ? 1920 : nil, alignment: .center)
        .at(look.dateLeft ?? 0, look.dateTop)
    }
}

/// One Keep watching card: the show's picture, the app, the title, the episode and how far in.
struct ContinueCard: View {
    @EnvironmentObject var model: HomeModel
    let item: ContinueItem
    let focused: Bool

    var body: some View {
        HStack(spacing: 20) {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.08))
                if let img = model.posters[item.id] {
                    Image(platform: img).resizable().scaledToFill()
                }
            }
            .frame(width: 168, height: 95)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    if let img = Pictures.logo(item.appPackage) {
                        Image(platform: img).resizable().frame(width: 26, height: 26)
                            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    }
                    Text((item.appName ?? "").uppercased()).kerning(1.1)
                        .font(HomeFont.inter(19, .medium)).foregroundStyle(.white.opacity(0.58))
                }
                .frame(height: 24)
                Text(item.title).font(HomeFont.inter(29, .semibold)).foregroundStyle(.white).lineLimit(1)
                    .frame(height: 36).padding(.top, 6)
                Text(item.episodeLine).font(HomeFont.inter(21)).foregroundStyle(.white.opacity(0.78)).lineLimit(1)
                    .frame(height: 28)
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.25))
                        Capsule().fill(Color.white).frame(width: g.size.width * min(1, max(0, item.progress ?? 0)))
                    }
                }
                .frame(height: 5)
                .padding(.top, 10)
                .opacity(item.progress == nil ? 0 : 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .frame(width: 520)
        .glass(30)
        .overlay(RoundedRectangle(cornerRadius: 33, style: .continuous).strokeBorder(.white, lineWidth: focused ? 3 : 0).padding(-3))
        .scaleEffect(focused ? 1.05 : 1)
        .shadow(color: .black.opacity(focused ? 0.45 : 0), radius: 20, y: 20)
        .animation(.easeOut(duration: 0.24), value: focused)
    }
}
