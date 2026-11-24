package dev.couchtv.ontv

import android.app.Application
import android.content.pm.PackageManager
import android.provider.Settings
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The play build itself (testPlayUnitTest): its merged manifest, no GitHub update or download path, and the
 * disclosure before Android's Accessibility settings.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class PlayBuildTest {
    private val app get() = RuntimeEnvironment.getApplication()

    @Before fun setUp() {
        Store.init(app); Tv.init(app); Adb.init(app)
        Store.putBool(PlayRules.AGREED_KEY, false)
    }

    @Test fun thisIsThePlayBuild() {
        assertEquals("play", BuildConfig.FLAVOR)
        assertTrue(Variant.play)
        assertTrue(Variant.hasWatch)
        assertEquals("0.13.15", BuildConfig.VERSION_NAME)
        assertTrue("Play versionCode above every GitHub build", BuildConfig.VERSION_CODE >= 1_000_000)
        assertEquals("1,000,000 + 100 x GitHub + 0", 0, BuildConfig.VERSION_CODE % 100)
    }

    @Test fun manifestKeepsOnlyWhatPlayAllows() {
        @Suppress("DEPRECATION")
        val info = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS)
        val asked = info.requestedPermissions?.toSet() ?: emptySet()
        listOf("android.permission.QUERY_ALL_PACKAGES", "android.permission.REQUEST_INSTALL_PACKAGES",
            "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.WRITE_SECURE_SETTINGS",
            "android.permission.PACKAGE_USAGE_STATS", "com.android.providers.tv.permission.READ_EPG_DATA", "android.permission.READ_TV_LISTINGS",
            "android.permission.FOREGROUND_SERVICE_SPECIAL_USE", "android.permission.READ_PHONE_STATE",
            "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE").forEach { assertFalse(it, it in asked) }
        listOf("android.permission.INTERNET", "android.permission.REQUEST_DELETE_PACKAGES",
            "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE", "android.permission.CHANGE_WIFI_MULTICAST_STATE")
            .forEach { assertTrue(it, it in asked) }
    }

    @Test fun phoneRemoteServiceIsConnectedDevice() {
        val s = app.packageManager.getServiceInfo(android.content.ComponentName(app, "dev.couchtv.ontv.BridgeService"), 0)
        assertEquals(android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE, s.foregroundServiceType)
    }

    @Test fun noScreenshotsAndNoBrowser() {
        assertFalse(PlayRules.screenshots(BuildConfig.FLAVOR))
        assertFalse(PlayRules.opensBrowser(BuildConfig.FLAVOR))
        assertNotNull(app.packageManager.getActivityInfo(android.content.ComponentName(app, LinkQrActivity::class.java), 0))
    }

    @Test fun manifestHasTheWatchAndTheDisclosure() {
        val pm = app.packageManager
        assertNotNull(pm.getServiceInfo(android.content.ComponentName(app, WatchService::class.java), 0))
        assertNotNull(pm.getActivityInfo(android.content.ComponentName(app, DisclosureActivity::class.java), 0))
    }

    @Test fun updateSaysPlayKeepsItUpToDate() {
        val s = JSONObject(Update.state(app))
        assertFalse(s.getBoolean("supported"))
        assertFalse(s.getBoolean("can_install"))
        assertFalse(s.getBoolean("available"))
        assertEquals(0, s.getJSONArray("steps").length())
        assertFalse(s.toString().contains("github", ignoreCase = true))
        // a check asks GitHub nothing: still nothing busy, nothing found
        Update.check(app, true)
        val after = JSONObject(Update.state(app))
        assertFalse(after.getBoolean("available"))
        assertFalse(after.optString("busy").isNotEmpty())
    }

    @Test fun homeKeyNeverOffersTheGitHubSteps() {
        val s = JSONObject(HomeKey.state(app))
        assertEquals("ready", s.getString("view"))
        assertEquals(PlayRules.READY, s.getString("words"))
        assertEquals(PlayRules.READY_PHONE, s.getString("words_phone"))
        assertFalse(s.getString("words").contains("GitHub"))
    }

    @Test fun pressWithoutAgreeOpensTheDisclosureNotAccessibility() {
        val shadow = shadowOf(app)
        while (shadow.nextStartedActivity != null) {}
        HomeKey.start(app)
        val first = shadow.nextStartedActivity
        assertNotNull(first)
        assertEquals(DisclosureActivity::class.java.name, first.component?.className)
        assertFalse(first.action == Settings.ACTION_ACCESSIBILITY_SETTINGS)
        assertNull("nothing else opened", shadow.nextStartedActivity)
        assertFalse("Agree was not pressed", Variant.agreed())
    }

    @Test fun settingsButtonWithoutAgreeOpensTheDisclosure() {
        val shadow = shadowOf(app)
        while (shadow.nextStartedActivity != null) {}
        DisclosureActivity.openAccessibility(app)
        assertEquals(DisclosureActivity::class.java.name, shadow.nextStartedActivity.component?.className)
    }

    @Test fun afterAgreeItOpensAccessibilitySettings() {
        Store.putBool(PlayRules.AGREED_KEY, true)
        val shadow = shadowOf(app)
        while (shadow.nextStartedActivity != null) {}
        DisclosureActivity.openAccessibility(app)
        assertEquals(Settings.ACTION_ACCESSIBILITY_SETTINGS, shadow.nextStartedActivity.action)
    }

    @Test fun agreeOnTheScreenRemembersItAndOpensAccessibility() {
        val a = org.robolectric.Robolectric.buildActivity(DisclosureActivity::class.java).setup().get()
        val shadow = shadowOf(app)
        while (shadow.nextStartedActivity != null) {}
        val agree = find(a.window.decorView, PlayRules.AGREE)
        assertNotNull("an Agree button", agree)
        agree!!.performClick()
        assertTrue(Variant.agreed())
        assertEquals(Settings.ACTION_ACCESSIBILITY_SETTINGS, shadowOf(a).nextStartedActivity?.action ?: shadow.nextStartedActivity?.action)
        assertTrue(a.isFinishing)
    }

    private fun find(v: android.view.View, text: String): android.view.View? {
        if (v is android.widget.TextView && v.text.toString() == text) return v
        if (v is android.view.ViewGroup) for (i in 0 until v.childCount) find(v.getChildAt(i), text)?.let { return it }
        return null
    }

    @Test fun theScreenShowsBothButtonsAndTheWords() {
        val a = org.robolectric.Robolectric.buildActivity(DisclosureActivity::class.java).setup().get()
        assertNotNull(find(a.window.decorView, PlayRules.AGREE))
        assertNotNull(find(a.window.decorView, PlayRules.NOT_NOW))
        assertNotNull(find(a.window.decorView, PlayRules.DISCLOSE_TITLE))
    }

    @Test fun notNowButtonRemembersNothing() {
        val a = org.robolectric.Robolectric.buildActivity(DisclosureActivity::class.java).setup().get()
        val shadow = shadowOf(app)
        while (shadow.nextStartedActivity != null) {}
        find(a.window.decorView, PlayRules.NOT_NOW)!!.performClick()
        assertFalse(Variant.agreed())
        assertTrue(a.isFinishing)
        assertNull("no settings opened", shadowOf(a).nextStartedActivity)
    }

    @Test fun noAskAiInPlay() {
        assertFalse(Ask.available)
        Store.putBool("ask_enabled", true)
        assertFalse("never on, whatever was saved", Ask.enabled)
        val s = Ask.status()
        assertFalse(s.getBoolean("available")); assertFalse(s.getBoolean("enabled"))
        // the setup page cannot switch it on either
        Ask.save(JSONObject().put("ask_enabled", true).put("ask_key", "sk-test"))
        assertFalse(Ask.enabled)
        assertTrue("the TV home is told", PlayPage().askOff())
        assertFalse("the phone remote is told", Store.publicConfig().getJSONObject("ask").getBoolean("enabled"))
    }

    @Test fun noWatchNextRowsInPlay() {
        assertFalse(WatchNext.granted())
        assertTrue(WatchNext.rows().isEmpty())
        assertTrue(WatchNext.cards(emptySet(), 5).isEmpty())
    }

    @Test fun notNowRemembersNothing() {
        val a = org.robolectric.Robolectric.buildActivity(DisclosureActivity::class.java).setup().get()
        @Suppress("DEPRECATION") a.onBackPressed()
        assertFalse(Variant.agreed())
        assertTrue(a.isFinishing)
    }
}
