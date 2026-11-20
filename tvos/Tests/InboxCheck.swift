// Get a design from your phone on the Apple TV (DesignModel.swift, DesignInbox): what it takes from the
// store's answers. No UI, no network.
//
//   swiftc -parse-as-library -o inbox-check tvos/CouchTV/DesignModel.swift tvos/Tests/InboxCheck.swift
//   ./inbox-check            prints "inbox checks: N passed" and exits 0, or the first failure and exits 1
import Foundation

@main
struct InboxCheck {
    static var n = 0
    static func check(_ ok: Bool, _ what: String) {
        if !ok { print("FAIL " + what); exit(1) }
        n += 1
    }
    static func data(_ o: Any) -> Data { (try? JSONSerialization.data(withJSONObject: o)) ?? Data() }

    static func main() {
        let id = "AbCdEfGhIjKlMnOpQrStUv"
        let now = Date(timeIntervalSince1970: 1_000_000)
        let b = DesignInbox.read(data(["id": id, "expires_in": 600, "poll_every": 4]), base: "https://designs.example", now: now)
        check(b?.link == "https://designs.example/design/#inbox=" + id, "the QR opens Studio with the inbox in the fragment")
        check(b?.every == 4 && b?.expires == now.addingTimeInterval(600), "every 4 s, for 10 minutes")
        check(DesignInbox.read(data(["id": id, "expires_in": 999_999, "poll_every": 0.1]), base: "https://x", now: now)?.every == 3, "never faster than every 3 s")
        check(DesignInbox.read(data(["id": id, "expires_in": 999_999]), base: "https://x", now: now)?.expires == now.addingTimeInterval(1800), "at most 30 minutes")
        check(DesignInbox.read(data(["id": "../../x"]), base: "https://x") == nil, "not an inbox id")
        check(DesignInbox.read(data(["id": id + "x"]), base: "https://x") == nil, "23 characters is not an inbox id")
        check(DesignInbox.read(Data("nope".utf8), base: "https://x") == nil, "not JSON")
        check(DesignInbox.readTake(status: 200, data: data(["state": "waiting"])) == .waiting, "waiting")
        check(DesignInbox.readTake(status: 200, data: data(["state": "ok", "code": "abcde fghjk"])) == .code("ABCDE-FGHJK"), "a code, read as a typed one")
        check(DesignInbox.readTake(status: 200, data: data(["state": "ok", "code": "https://evil.example/x.json"])) == .gone, "a link is never taken for a code")
        check(DesignInbox.readTake(status: 404, data: Data()) == .gone, "run out")
        if case .problem = DesignInbox.readTake(status: 500, data: Data()) { n += 1 } else { check(false, "a server error is a problem, not a code") }
        print("inbox checks: \(n) passed")
    }
}
