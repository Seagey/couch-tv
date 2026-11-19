// Couch TV for Apple TV: the couch-tv home as a native tvOS app. tvOS has no web view, so this
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
                if model.kidsOn { KidsView() }                          // kids mode: only the shelf (KidsView.swift)
                else if model.design != nil { DesignHomeView() }        // a couch-tv Studio design (DesignView.swift)
                else { HomeView() }
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
                // a design got by code: "Use this design?" before anything of it shows
                .fullScreenCover(isPresented: Binding(get: { model.pendingDesign != nil && !model.kidsOn && !model.showSettings },
                                                      set: { if !$0 && model.pendingDesign != nil { model.useDesign(false) } })) {
                    if let d = model.pendingDesign { DesignAskView(design: d).environmentObject(model) }
                }
                .preferredColorScheme(.dark)
                .onChange(of: phase) { _, now in
                    if now == .active { Task { await model.refresh() } }     // back from another app: fresh cards
                }
        }
    }
}
