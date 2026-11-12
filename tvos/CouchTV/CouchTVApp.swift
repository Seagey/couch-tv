// Couch TV for Apple TV (Beta): the couch-tv home as a native tvOS app. tvOS has no web view, so this
// draws the TV home's Night look again in SwiftUI and talks to the same bridge (docs/APPLE-TV.md).
import SwiftUI

@main
struct CouchTVApp: App {
    @StateObject private var model: HomeModel
    @Environment(\.scenePhase) private var phase

    init() {
        Pictures.registerFonts()
        _model = StateObject(wrappedValue: HomeModel())
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if model.kidsOn { KidsView() } else { HomeView() }      // kids mode: only the shelf (KidsView.swift)
            }
                .environmentObject(model)
                .onAppear { model.start() }
                // settings and every app never open over kids mode, whatever asks for them
                .fullScreenCover(isPresented: Binding(get: { model.showSettings && !model.kidsOn }, set: { model.showSettings = $0 })) {
                    SettingsView().environmentObject(model)
                }
                .fullScreenCover(isPresented: Binding(get: { model.showMore && !model.kidsOn }, set: { model.showMore = $0 })) {
                    MoreAppsView().environmentObject(model)
                }
                .preferredColorScheme(.dark)
                .onChange(of: phase) { _, now in
                    if now == .active { Task { await model.refresh() } }     // back from another app: fresh cards
                }
        }
    }
}
