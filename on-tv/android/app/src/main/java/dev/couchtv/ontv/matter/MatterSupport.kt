package dev.couchtv.ontv.matter

import android.content.Context
import android.os.Build
import java.io.File

/**
 * Can Matter run on this TV at all? Decided once at app start, without loading the library.
 * - libCHIPController.so uses getifaddrs and freeifaddrs, which Android only has from 7 (API 24):
 *   on Android 6 loading it would fail, so it is never loaded there.
 * - The library is built for ARM only. An Intel TV gets a small placeholder library (so Android
 *   still installs the app) and no libCHIPController.so in its native library folder.
 * The apps package their libraries compressed (useLegacyPackaging), so Android unpacks them to
 * applicationInfo.nativeLibraryDir and the file check is exact.
 */
object MatterSupport {
    const val LIB = "libCHIPController.so"
    const val MIN_SDK = 24
    const val NOTE_OLD_ANDROID = "Matter needs Android 7 or newer on this TV."
    const val NOTE_PROCESSOR = "Matter does not work on this TV: its processor is not one the Matter part of Couch TV was built for."

    /** Null when Matter can run; otherwise the plain sentence that says why not. */
    fun check(sdk: Int, libraryThere: Boolean): String? = when {
        sdk < MIN_SDK -> NOTE_OLD_ANDROID
        !libraryThere -> NOTE_PROCESSOR
        else -> null
    }

    /** GET /api/matter/devices "reason": a key the screens turn into words in their own language. */
    fun reason(unsupported: String?): String? = when (unsupported) {
        null -> null
        NOTE_OLD_ANDROID -> "android_old"
        else -> "processor"
    }

    /** GET /api/matter/devices "ready": never on a TV Matter can't run on; otherwise started, or nothing added and nothing wrong yet. */
    fun ready(unsupported: String?, started: Boolean, noDevices: Boolean, note: String?): Boolean =
        unsupported == null && (started || (noDevices && note == null))

    fun check(c: Context): String? =
        check(Build.VERSION.SDK_INT, c.applicationInfo.nativeLibraryDir?.let { File(it, LIB).isFile } == true)
}
