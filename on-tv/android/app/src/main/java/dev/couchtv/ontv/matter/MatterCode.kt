package dev.couchtv.ontv.matter

/**
 * Plain Kotlin: checks a Matter pairing code before the controller tries it, and turns what went
 * wrong into the four keys the phone page shows in plain words (matter-contract.md, Changes):
 * "expired", "wrong_code", "unreachable", "thread".
 */
object MatterCode {
    sealed class Parsed {
        /** An 11 or 21 digit manual code, digits only. */
        data class Manual(val digits: String) : Parsed()
        /** The text of a Matter QR code, "MT:..." (upper case). */
        data class Qr(val text: String) : Parsed()
        data class Bad(val key: String, val note: String) : Parsed()
    }

    private val QR = Regex("^MT:[0-9A-Z.\\-]{19,}$")

    /** Whatever the person typed or scanned: spaces, dashes and a lower case "mt:" are fine. */
    fun parse(raw: String?): Parsed {
        val t = raw?.trim().orEmpty()
        if (t.isEmpty()) return Parsed.Bad("wrong_code", "Type the 11 digit code, or scan the QR code.")
        if (t.startsWith("MT:", ignoreCase = true)) {
            val q = "MT:" + t.substring(3).uppercase()
            return if (QR.matches(q)) Parsed.Qr(q) else Parsed.Bad("wrong_code", "That QR code is not a Matter code.")
        }
        if (t.any { !(it.isDigit() || it == ' ' || it == '-') }) return Parsed.Bad("wrong_code", "The code is 11 digits.")
        val d = t.filter { it.isDigit() }
        if (d.length != 11 && d.length != 21) return Parsed.Bad("wrong_code", "The code is 11 digits. Check it and type it again.")
        // first digit 0 to 7 (8 and 9 are reserved), and a check digit at the end
        if (d[0] > '7') return Parsed.Bad("wrong_code", "That code is not right. Check it and type it again.")
        if (!verhoeffOk(d)) return Parsed.Bad("wrong_code", "One digit is not right. Check the code and type it again.")
        return Parsed.Manual(d)
    }

    // Verhoeff check digit (the Matter manual pairing code uses it on all digits before the last)
    private val D = arrayOf(
        intArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9), intArrayOf(1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
        intArrayOf(2, 3, 4, 0, 1, 7, 8, 9, 5, 6), intArrayOf(3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
        intArrayOf(4, 0, 1, 2, 3, 9, 5, 6, 7, 8), intArrayOf(5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
        intArrayOf(6, 5, 9, 8, 7, 1, 0, 4, 3, 2), intArrayOf(7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
        intArrayOf(8, 7, 6, 5, 9, 3, 2, 1, 0, 4), intArrayOf(9, 8, 7, 6, 5, 4, 3, 2, 1, 0))
    private val P = arrayOf(
        intArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9), intArrayOf(1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
        intArrayOf(5, 8, 0, 3, 7, 9, 6, 1, 4, 2), intArrayOf(8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
        intArrayOf(9, 4, 5, 3, 1, 2, 6, 8, 7, 0), intArrayOf(4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
        intArrayOf(2, 7, 9, 3, 8, 0, 6, 4, 1, 5), intArrayOf(7, 0, 4, 6, 9, 1, 3, 2, 5, 8))
    private val INV = intArrayOf(0, 4, 3, 2, 1, 5, 6, 7, 8, 9)

    fun checkDigit(payload: String): Int {
        var c = 0
        payload.reversed().forEachIndexed { i, ch -> c = D[c][P[(i + 1) % 8][ch - '0']] }
        return INV[c]
    }

    fun verhoeffOk(code: String) = code.length >= 2 && checkDigit(code.dropLast(1)) == code.last() - '0'

    // ---------------------------------------------------------------- what went wrong

    const val ERR_TIMEOUT = 0x32L
    const val ERR_INVALID_PASE_PARAMETER = 0x38L
    const val ERR_NOT_FOUND = 0xD8L

    val NOTES = mapOf(
        "expired" to "The code has run out or the device is not sharing any more. Get a new code in your home app and try again within a few minutes.",
        "wrong_code" to "That code is not right. Check the code in your home app and type it again.",
        "unreachable" to "The TV can't reach the device. Check it is switched on and on the same home network as the TV, then try again.",
        "thread" to "This device uses Thread, and the TV can't reach your Thread network. Your Google or Apple hub must be on the same network as the TV.",
    )

    /**
     * The key for a commissioning failure. [stage] is the last commissioning stage the controller
     * started (null if it never found the device), [error] the CHIP error code, [thread] whether the
     * device is on Thread (its address is IPv6 and not on this TV's own network) and [threadRoute]
     * whether the TV has a route to that Thread network.
     */
    fun failureKey(stage: String?, error: Long, thread: Boolean = false, threadRoute: Boolean = true): String {
        val core = error and 0xFFFFFFL
        if (thread && !threadRoute) return "thread"
        return when {
            core == ERR_INVALID_PASE_PARAMETER -> "wrong_code"
            stage == null || stage == "Error" -> if (core == ERR_TIMEOUT || core == ERR_NOT_FOUND || core == 0L) "expired" else "unreachable"
            stage == "SecurePairing" -> if (core == ERR_TIMEOUT) "expired" else "wrong_code"
            stage.startsWith("FindOperational") -> if (thread) "thread" else "unreachable"
            else -> "unreachable"
        }
    }
}
