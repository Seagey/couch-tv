package app.couchtv.launcher

import java.io.File

/**
 * Your own app icons and banners (docs/TV-HOME.md, "Your own app icons"). A picture named after an
 * app's package, in custom/icons or custom/banners in this app's own folder on the TV's storage
 * (Android/data/app.couchtv.launcher/files/custom), shows in place of that app's own icon or
 * banner. tv-home/tools/app-icons.sh puts them there. Nothing else is read: the name has to be a
 * package name and the kind one of the two folders, so a page cannot reach other files.
 */
object CustomArt {
    val KINDS = setOf("icons", "banners")

    /** PNG first, then JPEG, then WebP, when an app has more than one. */
    private val TYPES = linkedMapOf("png" to "image/png", "jpg" to "image/jpeg", "webp" to "image/webp")

    /** A package name: two or more dot-separated parts of letters, numbers and underscores. */
    private val PACKAGE = Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+")

    /** The picture for [pkg] in [root]/[kind], or null when there is none (or the name is not a package). */
    fun find(root: File?, kind: String, pkg: String): File? {
        if (root == null || kind !in KINDS || pkg.length > 255 || !PACKAGE.matches(pkg)) return null
        val dir = File(root, kind)
        return TYPES.keys.map { File(dir, "$pkg.$it") }.firstOrNull { it.isFile }
    }

    fun mime(f: File): String = TYPES[f.extension.lowercase()] ?: "application/octet-stream"
}
