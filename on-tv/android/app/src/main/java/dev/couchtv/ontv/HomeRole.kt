package dev.couchtv.ontv

import android.app.Activity
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings

/**
 * Making couch-tv the home screen with no computer (issue #98), the same request as the launcher's.
 * Here the home is an alias that is off until "Use as home screen" turns it on, so it is on before asking. On a plain Android TV 10 or newer
 * Android has its own "default home app" request: it shows the system's own chooser and the person
 * picks couch-tv with the remote. Older Androids get the Home settings screen if there is one, else
 * Android's "Select a home app" chooser. On Google TV the TV's own launcher can still win the Home
 * key, so there the home page explains the Home button watch (set up by apply.sh) instead of
 * promising this. It never switches off or removes the TV's own launcher.
 */
object HomeRole {
    const val REQUEST = 42
    private const val GOOGLE_TV_LAUNCHER = "com.google.android.apps.tv.launcherx"
    private const val ANDROID_TV_HOME = "com.google.android.tvlauncher"

    /** Google TV (the Google TV launcher is installed). Plain Android TV and the makers' own homes are not. */
    fun googleTv(c: Context): Boolean = try {
        c.packageManager.getPackageInfo(GOOGLE_TV_LAUNCHER, 0); true
    } catch (e: Exception) { false }

    /**
     * A Google home is installed: Google TV's, or Google's Android TV Home. A TCL on Android TV 11 kept
     * opening Android TV Home on Home although Couch TV held Android's home role (19 Nov 2026), so the
     * setup screen says so there instead of promising the Home button.
     */
    fun googleHome(c: Context): Boolean = googleTv(c) || try {
        c.packageManager.getPackageInfo(ANDROID_TV_HOME, 0); true
    } catch (e: Exception) { false }

    /** Whether Android lists this app's home alias as a home now (it takes a moment after the alias is switched on). */
    fun aliasListed(c: Context): Boolean = try {
        c.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)
            .any { it.activityInfo?.packageName == c.packageName }
    } catch (e: Exception) { false }

    /** Whether couch-tv is the home the Home key opens right now. */
    fun held(c: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 29) {
            val rm = c.getSystemService(RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME)) return rm.isRoleHeld(RoleManager.ROLE_HOME)
        }
        val ri = c.packageManager.resolveActivity(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
        return ri?.activityInfo?.packageName == c.packageName
    }

    /** How the TV was asked. ROLE: Android's own request, whose answer comes back in onActivityResult. */
    enum class Asked { ROLE, SCREEN, NONE }

    /** Opens Android's own chooser. NONE when this TV offers none. */
    fun request(a: Activity, code: Int = REQUEST): Asked = try {
        if (Build.VERSION.SDK_INT >= 29) {
            val rm = a.getSystemService(RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME)) {
                a.startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), code)
                Asked.ROLE
            } else fallback(a)
        } else fallback(a)
    } catch (e: Exception) { fallback(a) }

    private fun fallback(a: Activity): Asked = try {
        val settings = Intent(Settings.ACTION_HOME_SETTINGS)
        if (settings.resolveActivity(a.packageManager) != null) { a.startActivity(settings); Asked.SCREEN }
        else {
            // No Home settings screen: a Home intent with no default set makes Android ask "Select a home app".
            val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            a.startActivity(Intent.createChooser(home, null)); Asked.SCREEN
        }
    } catch (e: Exception) { Asked.NONE }
}
