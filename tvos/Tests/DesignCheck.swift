// A small command line checker for DesignModel.swift (no UI): it reads a file of cases and prints what the
// Apple TV's design gate made of each, as JSON, for tests/test_appletv_design.py.
//
//   swiftc -parse-as-library -o design-check tvos/CouchTV/DesignModel.swift tvos/Tests/DesignCheck.swift
//   ./design-check cases.json
//
// cases.json: {"designs": {name: design}, "codes": [typed], "colours": [text], "words": [text],
//              "stores": [config], "answers": [store answer as text], "dates": [format]}
import Foundation

@main
struct DesignCheck {
    static func main() {
        guard CommandLine.arguments.count > 1, let data = FileManager.default.contents(atPath: CommandLine.arguments[1]),
              let cases = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            print("usage: design-check <cases.json>")
            exit(2)
        }
        var out: [String: Any] = [:]
        var designs: [String: Any] = [:]
        for (name, raw) in cases["designs"] as? [String: Any] ?? [:] {
            designs[name] = n(Design.read(raw).map(summary))
        }
        out["designs"] = designs
        out["codes"] = (cases["codes"] as? [String] ?? []).map { n(DesignCode.read($0)) }
        out["colours"] = (cases["colours"] as? [Any] ?? []).map { c -> Any in
            guard let s = DesignGate.colour(c) else { return NSNull() }
            guard let v = DesignRGBA.parse(s) else { return [s] }
            return [s, round(v.r), round(v.g), round(v.b), round(v.a)]
        }
        out["words"] = (cases["words"] as? [Any] ?? []).map { n(DesignGate.words($0, 120)) }
        out["stores"] = (cases["stores"] as? [Any] ?? []).map { c -> Any in DesignCode.store(config: c as? [String: Any]) ?? "" }
        out["answers"] = (cases["answers"] as? [String] ?? []).map { a -> Any in
            n(DesignCode.accept(Data(a.utf8)).map { d -> Any in ["image": n((d["background"] as? [String: Any])?["image"])] })
        }
        out["messages"] = [404, 429, 503, 500].map { DesignCode.message(status: $0) }
        var when = DateComponents()
        (when.year, when.month, when.day, when.hour, when.minute) = (2026, 10, 27, 20, 5)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
        let date = cal.date(from: when)!
        out["dates"] = (cases["dates"] as? [String] ?? []).map { DesignDates.text(date, format: $0, timeZone: cal.timeZone) }
        out["time12"] = DesignDates.time(date, clock24: false, calendar: cal)
        out["time24"] = DesignDates.time(date, clock24: true, calendar: cal)
        out["words_time"] = DesignDates.words(date, calendar: cal)
        out["countdown"] = DesignDates.daysUntil(month: 12, day: 25, from: date, calendar: cal)
        out["factor"] = [DesignLayout.factor(width: 1920), DesignLayout.factor(width: 960), DesignLayout.factor(width: 3840)]
        out["native"] = DesignWidgets.kinds.filter(DesignWidgets.drawsNatively)
        out["fallback"] = DesignWidgets.kinds.filter { !DesignWidgets.drawsNatively($0) }.map { [$0, DesignWidgets.title($0)] }
        let json = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
        print(String(decoding: json, as: UTF8.self))
    }

    static func n(_ v: Any?) -> Any { v ?? NSNull() }

    static func round(_ d: Double) -> Double { (d * 1000).rounded() / 1000 }

    static func summary(_ d: Design) -> [String: Any] {
        var s: [String: Any] = [:]
        if let b = d.background {
            s["background"] = ["image": n(b.image), "colour": n(b.colour), "colour2": n(b.colour2),
                               "darken": b.darken, "zoom": b.zoom, "blur": b.blur, "angle": b.angle, "scrim": n(b.scrim)]
        }
        s["elements"] = d.elements.mapValues { p -> [String: Any] in
            ["x": p.place.x, "y": p.place.y, "scale": p.place.scale, "opacity": p.place.opacity, "hidden": p.place.hidden,
             "format": n(p.format), "colour": n(p.type.colour), "font": n(p.type.font), "at": n(p.at), "behind": n(p.behind)]
        }
        s["home"] = ["scenes": d.home.scenes, "sceneClock": d.sceneClock]
        s["texts"] = d.texts.map { ["text": $0.text, "x": $0.place.x, "size": n($0.size)] }
        s["objects"] = d.objects.map { o -> [String: Any] in
            let b = DesignLayout.box(o)
            return ["id": o.id, "type": o.type, "kind": n(o.kind), "layer": o.layer,
                    "native": o.type == "widget" ? DesignWidgets.drawsNatively(o.kind ?? "") as Any : NSNull(),
                    "title": DesignWidgets.title(o.kind ?? o.type), "x": b.x, "y": b.y, "w": b.w, "h": b.h,
                    "scale": o.place.scale, "rotate": o.place.rotate, "text": n(o.text), "colour": n(o.colour),
                    "variant": n(o.variant), "items": o.items.map { $0.kind ?? "" },
                    "opts": ["label": n(o.opts.label), "cities": o.opts.cities, "apps": o.opts.apps, "month": n(o.opts.month)]]
        }
        s["look"] = ["ink": n(d.look.ink), "panel": n(d.look.panel)]
        s["apps"] = ["order": d.apps.order, "hidden": d.apps.hidden]
        s["order"] = d.order(["a", "b", "c", "d"])
        return s
    }
}
