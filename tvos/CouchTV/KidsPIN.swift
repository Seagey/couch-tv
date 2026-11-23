// The parent PIN, checked on the Apple TV the way the TV home's kids.js checks it: SHA-256 applied
// `rounds` times to "salt:pin", compared with the hash the bridge sends (bridge/kids.py makes it the same
// way). The app is never given the PIN; the digits typed on the pad are only hashed, and sent to the
// bridge once, with the move to a grown up, so the bridge checks them too.
import CryptoKit
import Foundation

enum KidsPIN {
    static let shortest = 4
    static let longest = 8
    static let tries = 5             // wrong PINs within a minute, then the pad waits a minute
    static let wait: TimeInterval = 60

    static func hash(_ pin: String, salt: String, rounds: Int) -> String {
        var h = Data("\(salt):\(pin)".utf8)
        for _ in 0..<max(1, rounds) { h = Data(SHA256.hash(data: h)) }
        return h.map { String(format: "%02x", $0) }.joined()
    }

    static func matches(_ digits: String, _ shelf: KidsShelf) -> Bool {
        guard digits.count >= shortest, digits.count <= longest, digits.allSatisfy(\.isASCII), digits.allSatisfy(\.isNumber) else { return false }
        let a = Array(hash(digits, salt: shelf.pinSalt, rounds: shelf.pinRounds).utf8), b = Array(shelf.pinHash.utf8)
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0       // the same time for any wrong PIN
    }
}

/// The number pad's state while it is open.
struct PinPad: Equatable {
    var digits = ""
    var message = ""
    var wrong = 0                   // bumps on a wrong PIN, to shake the dots
}
