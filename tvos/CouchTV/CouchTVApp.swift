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
            HomeView()
                .environmentObject(model)
                .onAppear { model.start() }
                .fullScreenCover(isPresented: $model.showSettings) { SettingsView().environmentObject(model) }
                .fullScreenCover(isPresented: $model.showMore) { MoreAppsView().environmentObject(model) }
                .preferredColorScheme(.dark)
                .onChange(of: phase) { _, now in
                    if now == .active { Task { await model.refresh() } }     // back from another app: fresh cards
                }
        }
    }
}
