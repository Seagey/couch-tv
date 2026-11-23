package dev.couchtv.ontv

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings

/**
 * "Can't connect?" on the phone page (GET /api/adb/check, on-tv/web/connect-check.js).
 *
 * When the phone cannot press keys, this finds the one thing in the way, from what the TV can see:
 * the phone on another network, the TV on Ethernet (Wireless debugging needs Wi-Fi), debugging off,
 * no Wireless debugging on this Android, Allow debugging never answered, or the debugging port shut
 * (it closes after a restart on some TVs). The page turns the code into plain words with the fix,
 * in the phone page's language.
 *
 * "Copy a report" carries [report]: model, Android version, the connection state and the last error,
 * for asking for help. No addresses (masked), no keys, no TV name (people name TVs after themselves).
 */
object ConnectCheck {
    data class Facts(
        val sdk: Int,
        val connected: Boolean = false,
        val route: String? = null,
        val state: String = "off",
        val unanswered: Boolean = false,
        val everAllowed: Boolean = false,
        val tlsPaired: Boolean = false,
        val onWifi: Boolean = true,
        val onEthernet: Boolean = false,
        /** Developer options, USB (or Network) debugging: Settings.Global adb_enabled. null when it can't be read. */
        val debuggingOn: Boolean? = true,
        /** Android 11+ Wireless debugging: Settings.Global adb_wifi_enabled. null below Android 11. */
        val wirelessOn: Boolean? = null,
        /** Plain ADB on 127.0.0.1:5555 answers. */
        val port5555Open: Boolean = false,
        /** The phone's address is on the TV's own network. null when it can't tell. */
        val phoneSameNetwork: Boolean? = true,
        val fireBlocked: Boolean = false,
        /** A Fire TV (Build.MANUFACTURER Amazon): Fire OS has only ADB debugging on port 5555, never Wireless debugging. */
        val fireTv: Boolean = false,
        val lastError: String? = null,
    )

    /** Every answer the check can give, in the order it looks. The page has words for each. */
    val CODES = listOf("ok", "fire_blocked", "debugging_off", "waiting_allow", "allow_unanswered",
        "ethernet", "wireless_off", "needs_pairing", "port_closed", "no_wireless", "unknown")

    fun diagnose(f: Facts): String {
        if (f.connected) return "ok"
        // the phone's network is only in the report: the TV's ADB is its own (127.0.0.1), so another
        // network or VLAN never stops key presses, and blaming it would hide the real cause
        if (f.fireBlocked) return "fire_blocked"
        if (f.debuggingOn == false) return "debugging_off"
        if (f.state == "waiting_for_allow" || f.state == "connecting") return "waiting_allow"
        if (f.unanswered) return "allow_unanswered"
        // the port answers but Couch TV was not let in: the Allow question was missed or refused
        if (f.port5555Open) return "allow_unanswered"
        if (f.sdk >= 30 && !f.fireTv) {
            if (f.onEthernet && !f.onWifi) return "ethernet"
            if (f.wirelessOn == false) return "wireless_off"
            if (!f.tlsPaired) return "needs_pairing"
            return "port_closed"
        }
        // Android 10 or older, and every Fire TV: no Wireless debugging menu, only plain port 5555
        return if (f.everAllowed) "port_closed" else "no_wireless"
    }

    /** Addresses out (127.0.0.1 is the TV itself and says nothing about anyone), long tokens out, short. */
    fun mask(s: String?): String {
        if (s.isNullOrBlank()) return "none"
        var out = s.replace(Regex("\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b")) { if (it.value == "127.0.0.1") it.value else "[address]" }
        out = out.replace(Regex("(?<![\\w:])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{1,4}(?![\\w:])"), "[address]")
        out = out.replace(Regex("[A-Za-z0-9+/=_-]{24,}"), "[hidden]")
        out = out.replace(Regex("\\s+"), " ").trim()
        return if (out.length > 300) out.take(300) + "…" else out
    }

    /** Same IPv4 network, by the TV's own prefix length. null when either side is unknown or not IPv4. */
    fun sameNetwork(phone: String?, tv: String?, prefix: Int?): Boolean? {
        if (phone == null || tv == null) return null
        if (phone == "127.0.0.1" || phone == tv) return true
        val a = v4(phone) ?: return null
        val b = v4(tv) ?: return null
        val p = (prefix ?: 24).coerceIn(8, 32)
        val m = if (p == 32) -1L and 0xffffffffL else ((0xffffffffL shl (32 - p)) and 0xffffffffL)
        return (a and m) == (b and m)
    }

    private fun v4(s: String): Long? {
        val parts = s.removePrefix("::ffff:").split(".")
        if (parts.size != 4) return null
        var n = 0L
        for (p in parts) { val v = p.toIntOrNull() ?: return null; if (v !in 0..255) return null; n = (n shl 8) or v.toLong() }
        return n
    }

    private fun yn(b: Boolean?) = when (b) { true -> "yes"; false -> "no"; null -> "unknown" }

    /** The block "Copy a report" puts on the clipboard. English, so anyone helping can read it. */
    fun report(f: Facts, code: String, model: String, android: String, version: String): String = listOf(
        "Couch TV report",
        "App: on-TV $version",
        "TV: ${mask(model)}, Android $android (API ${f.sdk})",
        "Network: " + when { f.onWifi -> "Wi-Fi"; f.onEthernet -> "Ethernet"; else -> "none" },
        "Phone on the same network: ${yn(f.phoneSameNetwork)}",
        "Debugging on: ${yn(f.debuggingOn)}",
        "Wireless debugging on: " + (if (f.fireTv) "not on Fire TV" else if (f.sdk < 30) "not on this Android" else yn(f.wirelessOn)),
        "Paired for wireless debugging: ${yn(f.tlsPaired)}",
        "Allowed before: ${yn(f.everAllowed)}",
        "Port 5555 answers: ${yn(f.port5555Open)}",
        "Connection: ${f.state}" + (f.route?.let { " ($it)" } ?: ""),
        "Check says: $code",
        "Last error: ${mask(f.lastError)}",
    ).joinToString("\n")

    // ---------------------------------------------------------------- on the TV

    /** What the TV sees right now, the answer and the report. phoneIp: the asking phone's address. */
    fun run(ctx: Context, phoneIp: String?): Map<String, Any?> {
        val f = facts(ctx, phoneIp)
        val code = diagnose(f)
        return mapOf(
            "code" to code, "sdk" to f.sdk, "on_wifi" to f.onWifi, "on_ethernet" to f.onEthernet,
            "debugging_on" to f.debuggingOn, "wireless_on" to f.wirelessOn, "port_5555" to f.port5555Open,
            "same_network" to f.phoneSameNetwork, "fire_tv" to f.fireTv, "tls_paired" to f.tlsPaired, "state" to f.state,
            // the words follow the TV's Home settings language
            "lang" to ((Store.readJson("home-settings.json") as? org.json.JSONObject)?.optString("lang")?.ifEmpty { null }),
            "report" to report(f, code, "${Build.MANUFACTURER} ${Build.MODEL}", Build.VERSION.RELEASE ?: "?", BuildConfig.VERSION_NAME),
        )
    }

    private fun facts(ctx: Context, phoneIp: String?): Facts {
        val cr = ctx.contentResolver
        fun global(k: String): Boolean? = runCatching { Settings.Global.getInt(cr, k) == 1 }.getOrNull()
        var wifi = false; var eth = false; var tvIp: String? = null; var prefix: Int? = null
        runCatching {
            val cm = ctx.getSystemService(ConnectivityManager::class.java)
            val n = cm.activeNetwork
            val caps = cm.getNetworkCapabilities(n)
            wifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            eth = caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true
            cm.getLinkProperties(n)?.linkAddresses?.firstOrNull { it.address is java.net.Inet4Address && !it.address.isLoopbackAddress }
                ?.let { tvIp = it.address.hostAddress; prefix = it.prefixLength }
        }
        val err = Adb.lastError
        return Facts(
            sdk = Build.VERSION.SDK_INT, connected = Adb.connected, route = Adb.route, state = Adb.state,
            unanswered = Adb.unanswered, everAllowed = Adb.everAllowed, tlsPaired = Adb.paired,
            onWifi = wifi, onEthernet = eth,
            debuggingOn = global(Settings.Global.ADB_ENABLED),
            wirelessOn = if (Build.VERSION.SDK_INT >= 30) global("adb_wifi_enabled") else null,
            port5555Open = Adb.portOpen(5555),
            phoneSameNetwork = sameNetwork(phoneIp, tvIp ?: App.lanAddress(), prefix),
            fireBlocked = err?.contains(Adb.FIRE_BLOCKED) == true,
            fireTv = Build.MANUFACTURER.equals("Amazon", ignoreCase = true),
            lastError = err,
        )
    }
}
