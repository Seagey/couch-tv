// The TV home's look in SwiftUI: its fonts, the glass panels, and the focus effects (a white ring, the
// tile growing), drawn by the app itself rather than tvOS's default lift, so it matches the other TVs.
import SwiftUI

enum HomeFont {
    static func inter(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        switch weight {
        case .semibold, .bold, .heavy, .black: return .custom("CouchInter-SemiBold", fixedSize: size)
        case .medium: return .custom("CouchInter-Medium", fixedSize: size)
        default: return .custom("CouchInter-Regular", fixedSize: size)
        }
    }
}

/// The preview renderer has no focus engine: it names the one thing to draw as focused.
private struct PreviewFocusKey: EnvironmentKey { static let defaultValue: String? = nil }
private struct FlatGlassKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var previewFocus: String? {
        get { self[PreviewFocusKey.self] }
        set { self[PreviewFocusKey.self] = newValue }
    }

    /// The preview renderer: no blur behind glass panels and no scroll views (it cannot draw either).
    var flatGlass: Bool {
        get { self[FlatGlassKey.self] }
        set { self[FlatGlassKey.self] = newValue }
    }
}

/// True when this tile has the focus (or the preview says to draw it so).
struct Focused<Content: View>: View {
    let tag: String
    @ViewBuilder let content: (Bool) -> Content
    @Environment(\.isFocused) private var isFocused
    @Environment(\.previewFocus) private var preview

    var body: some View { content(isFocused || preview == tag) }
}

/// A button with no tvOS lift of its own: the label draws its own focus.
struct BareButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.85 : 1)
    }
}

/// The lock screen glass behind the people switch, the cards and the dock.
struct GlassPanel: ViewModifier {
    let radius: CGFloat
    @Environment(\.flatGlass) private var flat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                ZStack {
                    if flat {
                        shape.fill(Color(red: 40 / 255, green: 30 / 255, blue: 38 / 255).opacity(0.55))
                    } else {
                        shape.fill(.ultraThinMaterial)
                        shape.fill(Color(red: 30 / 255, green: 20 / 255, blue: 28 / 255).opacity(0.32))
                    }
                    shape.strokeBorder(Color(red: 1, green: 210 / 255, blue: 220 / 255).opacity(0.16), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.28), radius: 30, y: 24)
            }
    }
}

extension View {
    func glass(_ radius: CGFloat) -> some View { modifier(GlassPanel(radius: radius)) }

    /// Place on the 1920x1080 screen by the top left corner, the way the TV home's style sheet does.
    func at(_ x: CGFloat, _ y: CGFloat) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(.leading, x).padding(.top, y)
    }
}

/// An app's face: couch-tv's logo for it when there is one, else its first letter on a dark tile.
struct AppFace: View {
    let app: DockApp
    var size: CGFloat = 112

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.225, style: .continuous)
        ZStack {
            if let img = Pictures.logo(app.package) {
                Color(red: 28 / 255, green: 28 / 255, blue: 33 / 255)
                Image(platform: img).resizable().scaledToFill()
            } else {
                Color(red: 42 / 255, green: 42 / 255, blue: 48 / 255)
                Text(app.title)
                    .font(HomeFont.inter(size * 0.16, .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .padding(.horizontal, size * 0.08)
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
    }
}

/// A house tile in the dock (Settings, More apps): a symbol on soft glass.
struct ToolFace: View {
    let symbol: String
    var size: CGFloat = 112

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.225, style: .continuous).fill(Color.white.opacity(0.14))
            Image(systemName: symbol).font(.system(size: size * 0.32, weight: .light)).foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}
