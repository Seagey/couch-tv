package app.couchtv.launcher

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * The remote's gear (Settings) button. On some TVs (seen on an ONVO / MediaTek Google TV) that
 * button never reaches any app: Android's global-key table hands it to the maker's hot-key agent or
 * to the Google TV home, and with the Google TV home switched off nothing happens. An
 * accessibility service sees keys before that hand-off, so this one catches only the gear button
 * and opens couch-tv's own gear menu (Home settings or TV settings). Every other key is passed on
 * untouched, and it reads no screen content.
 *
 * It also opens an app from a remote button that the TV hands to no app (a YouTube, Netflix or other
 * shortcut key that the maker's own service swallows): `home.app_keys` in config.json, see appFor.
 *
 * Off until the person at the TV switches it on: Settings, System (or Device Preferences),
 * Accessibility, "Home gear button". Android switches it off again whenever the app is reinstalled.
 * undo.sh takes it away with couch-tv's other accessibility services.
 */
class KeyWatch : AccessibilityService() {
    override fun onAccessibilityEvent(e: AccessibilityEvent) {}
    override fun onInterrupt() {}

    override fun onKeyEvent(event: KeyEvent): Boolean {
        // `gear` as the target of an app_keys entry makes that button the gear button too ("scan66:gear")
        val mapped = if (isGear(event)) null else appFor(this, event)
        if (!isGear(event) && mapped != "gear") {
            val pkg = mapped ?: return false   // not ours: Android gets it as usual
            Log.i("couchtv-keywatch", "app key keyCode=${event.keyCode} scan=${event.scanCode} -> $pkg")
            if (event.action == KeyEvent.ACTION_UP && event.repeatCount == 0) {
                runCatching {
                    val i = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg)
                    if (i != null) startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
            return true
        }
        Log.i("couchtv-keywatch", "gear keyCode=${event.keyCode} scan=${event.scanCode} action=${event.action}")
        if (event.action == KeyEvent.ACTION_UP && event.repeatCount == 0) {
            runCatching {
                startActivity(Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra("gear", true))
            }
        }
        return true   // both the press and the release, so the old (dead) route never sees it
    }

    companion object {
        private var parsedFrom: String? = null
        private var parsed: List<Triple<Int, Int, String>> = emptyList()   // keyCode (or -1), scanCode (or -1), package

        /**
         * The app a remote button opens, from `home.app_keys`: "KEYCODE_BUTTON_3:org.smarttube.stable",
         * "190:com.google.android.youtube.tv" (an Android keycode) or "scan384:some.package" (a raw Linux
         * scancode, for a button Android does not map). Null for every other key. The list is parsed again
         * only when the saved settings change, since this runs for every key press.
         */
        fun appFor(ctx: Context, e: KeyEvent): String? {
            val raw = ctx.getSharedPreferences("home", Context.MODE_PRIVATE).getString("config", null)
            if (raw != parsedFrom) {
                parsed = runCatching {
                    val a = JSONObject(raw ?: "{}").optJSONObject("home")?.optJSONArray("app_keys")
                    (0 until (a?.length() ?: 0)).mapNotNull { n ->
                        val item = a!!.optString(n)
                        val at = item.indexOf(':')
                        if (at <= 0 || at == item.length - 1) return@mapNotNull null
                        val k = item.substring(0, at).trim()
                        val pkg = item.substring(at + 1).trim()
                        when {
                            k.startsWith("scan") -> k.substring(4).toIntOrNull()?.let { Triple(-1, it, pkg) }
                            k.all { it.isDigit() } -> k.toIntOrNull()?.let { Triple(it, -1, pkg) }
                            else -> KeyEvent.keyCodeFromString(k).takeIf { it != KeyEvent.KEYCODE_UNKNOWN }?.let { Triple(it, -1, pkg) }
                        }
                    }
                }.getOrDefault(emptyList())
                parsedFrom = raw
            }
            return parsed.firstOrNull { (kc, sc, _) -> (kc >= 0 && kc == e.keyCode) || (sc >= 0 && sc == e.scanCode) }?.third
        }

        /** The ONVO remote's gear: KEYCODE_BUTTON_14 (201), raw Linux KEY_TAPE (0x180 = 384), which
         *  the global-key table hands to MediaTek's hot-key agent. 176 is Android's own Settings key,
         *  kept for remotes that send it. */
        const val GEAR_SCAN = 384

        fun isGear(e: KeyEvent): Boolean = e.keyCode == KeyEvent.KEYCODE_BUTTON_14 ||
            e.scanCode == GEAR_SCAN || e.keyCode == KeyEvent.KEYCODE_SETTINGS
    }
}
