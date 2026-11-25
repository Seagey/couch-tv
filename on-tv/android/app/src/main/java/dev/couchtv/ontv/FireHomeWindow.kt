package dev.couchtv.ontv

/** Amazon hosts search and Settings in its launcher package as well as the actual home. */
internal object FireHomeWindow {
    /**
     * How long after a restart (SystemClock.elapsedRealtime) a newly connected watch counts as connected
     * at power on, when Amazon's home has already come up unseen. The TV home app uses the same two
     * minutes (FireWatch, issue #44).
     */
    const val BOOT_WINDOW_MS = 2 * 60_000L
    fun justRestarted(sinceBootMs: Long): Boolean = sinceBootMs in 0 until BOOT_WINDOW_MS

    fun isHome(pkg: String?, cls: String?, resolvedHomes: Set<String> = emptySet()): Boolean =
        pkg == "com.amazon.tv.launcher" && cls != null &&
            (cls == "com.amazon.tv.launcher.ui.HomeActivity_vNext" ||
                cls == "com.amazon.tv.launcher.ui.HomeActivity" || cls in resolvedHomes)

    /**
     * The new enabled_accessibility_services value for the home watch, or null to leave it alone.
     * Only the watch build (couch-tv-ontv-watch.apk) has the service: there it is added once. The plain
     * build has none, so it never writes it, and takes out a stale entry an earlier plain 0.13.3 wrote
     * (Android would otherwise keep listing a service this app does not have).
     */
    fun watchServices(current: String?, me: String, declared: Boolean): String? {
        val list = (current ?: "").split(':').filter { it.isNotEmpty() }
        return when {
            declared && me !in list -> (list + me).joinToString(":")
            !declared && me in list -> list.filter { it != me }.joinToString(":")
            else -> null
        }
    }
}
