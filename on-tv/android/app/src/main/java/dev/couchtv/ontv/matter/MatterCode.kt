package dev.couchtv.ontv.matter

/**
 * Plain Kotlin: checks a Matter pairing code before the controller tries it, and turns what went
 * wrong into the four keys the phone page shows in plain words (matter-contract.md, Changes):
 * "expired", "wrong_code", "unreachable", "thread", and "already" (the device is on the TV already).
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
    const val ERR_FABRIC_EXISTS = 0x7EL

    val NOTES = mapOf(
        "expired" to "The code has run out or the device is not sharing any more. Get a new code in your home app and try again within a few minutes.",
        "wrong_code" to "That code is not right. Check the code in your home app and type it again.",
        "unreachable" to "The TV can't reach the device. Check it is switched on and on the same home network as the TV, then try again.",
        "thread" to "This device uses Thread, and the TV can't reach your Thread network. Your Google or Apple hub must be on the same network as the TV.",
        "already" to "That device is already on the TV.",
    )

    /**
     * The key for a commissioning failure. [stage] is the last commissioning stage the controller
     * started (null if it never found the device), [error] the CHIP error code, [thread] whether the
     * device is on Thread (its address is IPv6 and not on this TV's own network) and [threadRoute]
     * whether the TV has a route to that Thread network.
     */
    fun failureKey(stage: String?, error: Long, thread: Boolean = false, threadRoute: Boolean = true): String {
        val core = error and 0xFFFFFFL
        if (core == ERR_FABRIC_EXISTS) return "already"   // shared again to the TV it is already on
        if (thread && !threadRoute) return "thread"
        return when {
            core == ERR_INVALID_PASE_PARAMETER -> "wrong_code"
            stage == null || stage == "Error" -> if (core == ERR_TIMEOUT || core == ERR_NOT_FOUND || core == 0L) "expired" else "unreachable"
            stage == "SecurePairing" -> if (core == ERR_TIMEOUT) "expired" else "wrong_code"
            stage.startsWith("FindOperational") -> if (thread) "thread" else "unreachable"
            else -> "unreachable"
        }
    }

    /**
     * The key and reason for a failed commission (contract change 15: every refusal carries a reason).
     * With an address named in the request, a device that never answered there is "unreachable" with
     * reason "address" (not "expired": the TV tried only that address, any port 1 to 65535). Otherwise
     * the reason is the key itself.
     */
    fun commissionFailure(key: String, viaAddress: Boolean): Pair<String, String> =
        if (viaAddress && key == "expired") "unreachable" to "address" else key to key

    /** The note for [key] and [reason]: an address that never answered gets its own line. */
    fun failureNote(key: String, reason: String): String =
        if (key == "unreachable" && reason == "address") ADDRESS_SILENT else NOTES[key] ?: NOTES.getValue("unreachable")

    const val ADDRESS_SILENT = "Nothing answered at that address. Check the address and the port, or leave it empty and the TV finds the device itself."

    /** A refused commission as the API answers it: ok false, error [key], a plain note, no ids, and always a reason. */
    fun failure(key: String, note: String, reason: String = key): org.json.JSONObject =
        org.json.JSONObject().put("ok", false).put("error", key).put("note", note).put("device_ids", org.json.JSONArray()).put("reason", reason)

    // ---------------------------------------------------------------- an address typed with the code

    /** A checked address: [host] and [port], or [reason] ("address", "port", "link_local") and a plain [note]. */
    data class Address(val host: String = "", val port: Int = 0, val reason: String? = null, val note: String? = null)

    const val MATTER_PORT = 5540
    private val V4 = Regex("""^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$""")
    private val V6 = Regex("""^[0-9A-Fa-f:.]{2,45}$""")
    private val SCOPE = Regex("""^[A-Za-z0-9_.]{1,16}$""")
    val ADDRESS_NOTES = mapOf(
        "address" to "That address is not one the TV can use. It is four numbers with dots between them, or an IPv6 address. Leave it empty and the TV finds the device itself.",
        "port" to "The port after the address must be a number from 1 to 65535. Leave it out and the TV uses the Matter port.",
        "link_local" to "That address only works together with the name of the TV's network connection, for example %wlan0. Leave it empty and the TV finds the device itself.",
    )

    /**
     * "host", "host:port", "[v6]:port" or a bare IPv6 address. Only number addresses: the TV never
     * looks a name up here (that would go to whatever DNS server the network gives).
     */
    fun address(raw: String): Address {
        val a = raw.trim()
        fun bad(r: String) = Address(reason = r, note = ADDRESS_NOTES[r])
        val host: String
        var portText: String? = null
        when {
            a.startsWith("[") -> {
                if (!a.contains(']')) return bad("address")
                host = a.substring(1).substringBefore(']')
                val rest = a.substringAfter(']')
                if (rest.isNotEmpty()) { if (!rest.startsWith(":")) return bad("address"); portText = rest.substring(1) }
            }
            a.count { it == ':' } == 1 -> { host = a.substringBefore(':'); portText = a.substringAfter(':') }
            else -> host = a
        }
        val port = if (portText == null) MATTER_PORT else portText.takeIf { t -> t.isNotEmpty() && t.length <= 5 && t.all { it.isDigit() } }?.toInt()?.takeIf { it in 1..65535 } ?: return bad("port")
        if (V4.matches(host)) return Address(host, port)
        val bare = host.substringBefore('%')
        val scope = if (host.contains('%')) host.substringAfter('%') else null
        if (!host.contains(':') || !V6.matches(bare) || (scope != null && !SCOPE.matches(scope))) return bad("address")
        val ip = runCatching { java.net.InetAddress.getByName(bare) }.getOrNull() as? java.net.Inet6Address ?: return bad("address")
        if (ip.isLinkLocalAddress && scope == null) return bad("link_local")
        return Address(host, port)
    }
}
