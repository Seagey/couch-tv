package dev.couchtv.ontv

/** Amazon hosts search and Settings in its launcher package as well as the actual home. */
internal object FireHomeWindow {
    fun isHome(pkg: String?, cls: String?, resolvedHomes: Set<String> = emptySet()): Boolean =
        pkg == "com.amazon.tv.launcher" && cls != null &&
            (cls == "com.amazon.tv.launcher.ui.HomeActivity_vNext" ||
                cls == "com.amazon.tv.launcher.ui.HomeActivity" || cls in resolvedHomes)
}
