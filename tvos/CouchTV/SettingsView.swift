// Couch TV's own settings: which couch-tv bridge to use (found on the network, or typed in), the code
// that swaps for its pairing key, and the clock. Back (Menu) on the Siri remote closes it.
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: HomeModel
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var secret = ""
    @State private var busy = false
    @State private var problem = ""
    @State private var done = ""
    @Environment(\.flatGlass) private var flat

    var body: some View {
        ZStack(alignment: .topLeading) {
            SceneBackdrop(look: SceneLook.byId("night"), time: model.timeText(Date()), late: false)
                .blur(radius: 40)
                .scaleEffect(1.12)
                .overlay(Color.black.opacity(0.45))
            HStack(alignment: .top, spacing: 80) {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Couch TV settings").font(HomeFont.inter(57, .semibold)).foregroundStyle(.white)
                    Text(statusLine).font(HomeFont.inter(27)).foregroundStyle(.white.opacity(0.8))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 12)
                    section("The couch-tv bridge")
                    if !model.found.isEmpty {
                        ForEach(model.found) { f in
                            row(tag: "found:" + f.url, title: f.name, detail: shortURL(f.url)) { address = f.url }
                        }
                    }
                    field("Bridge address", text: $address, prompt: "192.0.2.20:5400")
                    field("Code or pairing key", text: $secret, prompt: "Six digit code, or leave empty")
                    Text("No pairing key on the bridge: leave it empty. With one: on the bridge computer run scripts/appletv-home-code.py and type the six digits it shows.")
                        .font(HomeFont.inter(21)).foregroundStyle(.white.opacity(0.62))
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 24) {
                        pill(tag: "connect", title: busy ? "Connecting…" : "Connect") { connect() }
                        if model.bridge.link != nil {
                            pill(tag: "forget", title: "Forget this bridge") { model.forget(); done = "Forgotten." }
                        }
                    }
                    .padding(.top, 6)
                    if !problem.isEmpty {
                        Text(problem).font(HomeFont.inter(23, .medium)).foregroundStyle(Color(red: 1, green: 0.62, blue: 0.54))
                    }
                    if !done.isEmpty {
                        Text(done).font(HomeFont.inter(23, .medium)).foregroundStyle(.white)
                    }
                }
                .frame(width: 900, alignment: .leading)
                .focusSection()

                VStack(alignment: .leading, spacing: 18) {
                    section("Clock")
                    HStack(spacing: 20) {
                        pill(tag: "12h", title: "12 hour", on: !model.clock24) { model.setLocalClock(false) }
                        pill(tag: "24h", title: "24 hour", on: model.clock24) { model.setLocalClock(true) }
                    }
                    if model.prefs.clock24 != nil {
                        note("Set on the bridge (Home settings on the phone), which wins over this.")
                    }
                    section("Good to know").padding(.top, 28)
                    note("Apple's Home button still opens Apple's home: tvOS lets no app replace it. With the bridge running, Couch TV opens by itself when the Apple TV wakes.")
                    note("Apps open through the bridge, because a tvOS app cannot open another app by itself. A few (YouTube, Netflix, Spotify) also open without it.")
                    note("Without the bridge the clock, the date and the scenes still work, and the apps you saw last stay in the dock.")
                    note(["Couch TV", Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String, "(Beta)"]
                        .compactMap { $0 }.joined(separator: " "))
                }
                .frame(width: 760, alignment: .leading)
                .focusSection()
            }
            .padding(.leading, 120)
            .padding(.top, 110)
        }
        .frame(width: 1920, height: 1080)
        .clipped()
        .ignoresSafeArea()
        .onAppear {
            address = model.bridge.link?.url ?? model.found.first?.url ?? ""
        }
    }

    private var statusLine: String {
        switch model.state {
        case .connected:
            let name = model.bridge.link?.name.map { " as \($0)" } ?? ""
            return "Connected to the bridge at \(shortURL(model.bridge.link?.url ?? ""))\(name)."
        case .connecting: return "Connecting to the bridge…"
        case .needsCode(let why), .down(let why): return why
        case .notSet:
            return model.found.isEmpty ? "Not connected. No couch-tv bridge found on this network yet: type its address."
                : "Not connected. Pick the bridge below, then Connect."
        }
    }

    private func shortURL(_ u: String) -> String {
        u.replacingOccurrences(of: "http://", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func connect() {
        guard !busy else { return }
        busy = true
        problem = ""
        done = ""
        Task {
            if let why = await model.connect(address: address, secret: secret) {
                problem = why
            } else {
                secret = ""
                done = "Connected. Press Back to go home."
            }
            busy = false
        }
    }

    // MARK: pieces

    private func section(_ t: String) -> some View {
        Text(t.uppercased()).kerning(1.4).font(HomeFont.inter(21, .semibold)).foregroundStyle(.white.opacity(0.6))
    }

    private func note(_ t: String) -> some View {
        Text(t).font(HomeFont.inter(23)).foregroundStyle(.white.opacity(0.78)).fixedSize(horizontal: false, vertical: true)
    }

    private func field(_ label: String, text: Binding<String>, prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(HomeFont.inter(21, .medium)).foregroundStyle(.white.opacity(0.7))
            if flat {      // the preview renderer cannot draw a text field: a look-alike
                Text(text.wrappedValue.isEmpty ? prompt : text.wrappedValue)
                    .font(HomeFont.inter(29))
                    .foregroundStyle(.white.opacity(text.wrappedValue.isEmpty ? 0.45 : 0.95))
                    .padding(.horizontal, 24)
                    .frame(width: 900, height: 66, alignment: .leading)
                    .glass(14)
            } else {
                TextField(prompt, text: text)
                    .font(HomeFont.inter(29))
                    .autocorrectionDisabled()
                    #if os(tvOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .frame(width: 900)
            }
        }
    }

    private func row(tag: String, title: String, detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Focused(tag: tag) { f in
                HStack {
                    Image(systemName: "desktopcomputer").font(.system(size: 30, weight: .light))
                    Text(title).font(HomeFont.inter(27, .semibold))
                    Spacer()
                    Text(detail).font(HomeFont.inter(23)).opacity(0.7)
                }
                .foregroundStyle(f ? Color(white: 0.07) : .white)
                .padding(.horizontal, 28)
                .frame(width: 900, height: 76)
                .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(f ? Color.white : .clear))
                .glass(22)
                .scaleEffect(f ? 1.03 : 1)
                .animation(.easeOut(duration: 0.2), value: f)
            }
        }
        .buttonStyle(BareButton())
    }

    private func pill(tag: String, title: String, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Focused(tag: tag) { f in
                Text(title)
                    .font(HomeFont.inter(27, .semibold))
                    .foregroundStyle(f || on ? Color(white: 0.07) : .white)
                    .padding(.horizontal, 36)
                    .frame(height: 68)
                    .background(Capsule().fill(f ? Color.white : (on ? Color.white.opacity(0.82) : .clear)))
                    .glass(34)
                    .overlay(Capsule().strokeBorder(.white, lineWidth: f ? 3 : 0).padding(-4))
                    .scaleEffect(f ? 1.06 : 1)
                    .animation(.easeOut(duration: 0.2), value: f)
            }
        }
        .buttonStyle(BareButton())
    }
}

/// Every app on the Apple TV, from More apps in the dock.
struct MoreAppsView: View {
    @EnvironmentObject var model: HomeModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.flatGlass) private var flat

    var body: some View {
        ZStack(alignment: .topLeading) {
            SceneBackdrop(look: model.look, time: model.timeText(Date()), late: false)
                .blur(radius: 40)
                .scaleEffect(1.12)
                .overlay(Color.black.opacity(0.4))
            VStack(alignment: .leading, spacing: 10) {
                Text("All apps").font(HomeFont.inter(48, .semibold)).foregroundStyle(.white).padding(.leading, 30)
                if flat {
                    grid      // the preview renderer draws no scroll view
                } else {
                    ScrollView { grid }
                }
            }
            .padding(.leading, 90)
            .padding(.top, 90)
            .padding(.trailing, 50)
        }
        .frame(width: 1920, height: 1080)
        .clipped()
        .ignoresSafeArea()
    }

    private var grid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(160), spacing: 48), count: 8), alignment: .leading, spacing: 64) {
            ForEach(model.apps) { app in
                Button { dismiss(); model.open(app) } label: {
                    Focused(tag: "all:" + app.id) { f in
                        VStack(spacing: 14) {
                            AppFace(app: app, size: 150)
                                .overlay(RoundedRectangle(cornerRadius: 37.75, style: .continuous)
                                    .strokeBorder(.white, lineWidth: f ? 4 : 0).padding(-4))
                                .scaleEffect(f ? 1.12 : 1)
                                .shadow(color: .black.opacity(f ? 0.4 : 0), radius: 20, y: 16)
                            Text(app.title).font(HomeFont.inter(21, .semibold)).foregroundStyle(.white)
                                .lineLimit(1).frame(width: 170)
                        }
                        .animation(.easeOut(duration: 0.2), value: f)
                    }
                }
                .buttonStyle(BareButton())
            }
        }
        .padding(30)
    }
}
