package dev.couchtv.ontv

import android.app.Activity
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.widget.Toast
import java.net.NetworkInterface
import java.security.Security

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        // TLS 1.3 for wireless debugging on every Android version (the ADB library asks for it).
        runCatching { Security.insertProviderAt(org.conscrypt.Conscrypt.newProvider(), 1) }
        Store.init(this); Adb.init(this); Tv.init(this)
        // Matter: the resolver with the IPv6 fallback and the Thread route check (before the first Matter call)
        runCatching { dev.couchtv.ontv.matter.DiscoveryChipResolver.install(this) }.onFailure { Log.w("couchtv", "matter discovery: ${it.message}") }
        // Matter devices added before: start the controller and their live state (no library load if none)
        runCatching { dev.couchtv.ontv.matter.Matter.init(this) }.onFailure { Log.w("couchtv", "matter init: ${it.message}") }
        instance = this
        // after "Make Home open Couch TV" put the watch APK on over this one: switch its watch on and check it (HomeKey)
        HomeKey.resume(this)
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityResumed(a: Activity) { resumed++ }
            override fun onActivityPaused(a: Activity) { resumed-- }
            override fun onActivityCreated(a: Activity, b: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
    }

    companion object {
        lateinit var instance: App
        @Volatile private var resumed = 0
        @Volatile var note: String? = null
        private val main = Handler(Looper.getMainLooper())
        private val sleepFire = Runnable { fireSleep() }

        val inForeground get() = resumed > 0

        fun startService(c: Context) {
            runCatching {
                val i = Intent(c, BridgeService::class.java)
                // Android 7 (Fire OS 6) has no startForegroundService; the plain start is allowed there
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i) else c.startService(i)
            }
                .onFailure { Log.w("couchtv", "could not start the service: ${it.message}") }
        }

        /** Puts the pairing code on the TV screen. */
        fun showPin() {
            val c = instance
            main.post {
                try {
                    c.startActivity(Intent(c, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("pin", true))
                } catch (e: Exception) { }
                // If Android blocks the screen from opening (app in the background), a toast still shows.
                if (!inForeground) Auth.currentPin()?.let { Toast.makeText(c, "Couch TV phone code: ${it.take(3)} ${it.drop(3)}", Toast.LENGTH_LONG).show() }
            }
        }

        fun openHome() {
            val c = instance
            main.post { runCatching { c.startActivity(Intent(c, HomeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
        }

        fun setSleep(ends: Long?) {
            Now.sleepEnds = ends
            main.removeCallbacks(sleepFire)
            if (ends != null) main.postDelayed(sleepFire, maxOf(0, ends - System.currentTimeMillis()))
            Now.push()
        }

        private fun fireSleep() {
            Now.sleepEnds = null
            Thread {
                runCatching { Tv.key("pause"); Thread.sleep(800); Tv.powerOff() }.onFailure { Log.w("couchtv", "sleep timer: ${it.message}") }
                Now.push()
            }.start()
        }

        /** The TV's address on the home network, for "open http://<this>:5400 on your phone". */
        fun lanAddress(): String? = activeAddress() ?: runCatching {
            NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }.firstOrNull { it is java.net.Inet4Address && it.isSiteLocalAddress }?.hostAddress
        }.getOrNull()

        /** The address on the network Android is actually using (Wi-Fi or Ethernet). */
        private fun activeAddress(): String? = runCatching {
            val cm = instance.getSystemService(android.net.ConnectivityManager::class.java)
            cm.getLinkProperties(cm.activeNetwork)?.linkAddresses?.map { it.address }
                ?.firstOrNull { it is java.net.Inet4Address && !it.isLoopbackAddress }?.hostAddress
        }.getOrNull()

        /** The HOME intent filter sits on an alias that is off by default, so installing never steals the home button. */
        fun homeEnabled(c: Context) = c.packageManager.getComponentEnabledSetting(ComponentName(c, "${c.packageName}.HomeAlias")) ==
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED

        fun setHomeEnabled(c: Context, on: Boolean) = c.packageManager.setComponentEnabledSetting(ComponentName(c, "${c.packageName}.HomeAlias"),
            if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
    }
}

/** Keeps the server running while the TV is on. Started at boot, when the app opens, and after an update. */
class BridgeService : Service() {
    private var server: Server? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var multicast: WifiManager.MulticastLock? = null

    override fun onBind(i: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        // Notification channels start at Android 8; Android 7 (Fire OS 6) builds the notification without one
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel("bridge", "Couch TV remote", NotificationManager.IMPORTANCE_LOW))
            Notification.Builder(this, "bridge")
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        val n = b.setContentTitle("Couch TV").setContentText("Phone remote is on")
            .setSmallIcon(R.drawable.icon).setOngoing(true).build()
        // The typed startForeground and FOREGROUND_SERVICE_TYPE_SPECIAL_USE only exist on Android 14.
        // Older TVs (Android 9 to 13) crash on them, so they get the plain call.
        note = n
        foreground()
        val wm = applicationContext.getSystemService(WifiManager::class.java)
        wifiLock = runCatching { wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "couchtv").apply { acquire() } }.getOrNull()
        multicast = runCatching { wm.createMulticastLock("couchtv-mdns").apply { setReferenceCounted(false); acquire() } }.getOrNull()
        startServer()
        // Xiaomi: PatchWall opened itself whenever the screen came on (FireHome.onScreenOn checks the switch).
        if (FireHome.isXiaomi) runCatching { registerReceiver(screenOn, android.content.IntentFilter(Intent.ACTION_SCREEN_ON)) }
        HisenseAllow.start(this)
        Now.start()
        Thread {
            runCatching { if (Adb.everAllowed || Adb.paired) Adb.ensure() }
            reenableStockHome()
            FireHome.poke()   // Fire TV: keep this home on the Home key across reboots
        }.start()
    }

    /**
     * couch-tv 0.10 and older switched off the TV's own home screens and setup wizard, which can leave
     * a Google TV looping after a restart. Over the ADB connection this app already holds (nothing new
     * is asked for), switch those three packages back on, once, only if installed and switched off.
     * If ADB is not connected yet, the next start tries again.
     */
    private fun reenableStockHome() {
        if (Store.bool("stock_home_reenabled") || !Adb.connected) return
        runCatching {
            val off = Adb.shell("pm list packages -d", 10_000).lines().map { it.removePrefix("package:").trim() }
            for (p in listOf("com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher", "com.google.android.tungsten.setupwraith")) {
                if (p in off) {
                    Adb.shell("pm enable $p", 10_000)
                    Log.w("couchtv", "switched $p back on (couch-tv 0.10 and older had switched it off)")
                }
            }
            Store.putBool("stock_home_reenabled", true)
        }.onFailure { Log.w("couchtv", "stock home re-enable failed: ${it.message}") }
    }

    private fun startServer() {
        if (server != null) return
        // smart home set up from a phone (/ha, app.couchtv.ha.HaPhone): the home redraws at once
        app.couchtv.ha.HaPhone.onChange = { HomeActivity.smartChanged() }
        try {
            server = Server(this, Store.port).also { it.start(fi.iki.elonen.NanoHTTPD.SOCKET_READ_TIMEOUT, false) }
            Log.i("couchtv", "server on port ${Store.port}")
        } catch (e: Exception) { Log.e("couchtv", "server failed to start", e) }
    }

    private var note: Notification? = null

    private fun foreground() {
        val n = note ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Play: connectedDevice (the phone is the device; src/play/AndroidManifest.xml), else specialUse as before
            startForeground(1, n, if (Variant.play) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(1, n)
        }
    }

    // Every startForegroundService needs its own startForeground. Two at once (the app opened again by
    // an update's shell line while Android sends MY_PACKAGE_REPLACED) crashed 0.13.8 on a real TCL
    // ten seconds later, so each start says it again; it costs nothing when already in front.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int { runCatching { foreground() }; startServer(); return START_STICKY }

    private val screenOn = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { FireHome.onScreenOn() }
    }

    override fun onDestroy() {
        if (FireHome.isXiaomi) runCatching { unregisterReceiver(screenOn) }
        server?.stop(); server = null
        runCatching { wifiLock?.release() }; runCatching { multicast?.release() }
        super.onDestroy()
    }
}

/**
 * Hisense Google TV ("SmartTV 4K", Android 11, board songshan; #202). Hisense's framework hook
 * (com.vt.hisensehook in services.jar) kills every third-party process when the TV goes to standby and,
 * from boot until a wake, refuses any non-system app's background process start ("Failure starting
 * process"): no BOOT_COMPLETED, no accessibility service, so the Google home stays up after a restart.
 * Its only exception is Settings.Global "allowed_self_launch_3rd_packages" (";"-separated), which it
 * reads once per boot, early, and something on the TV then empties about 25 s after every boot. So keep
 * this app in that list: write it whenever the app runs (start, 60 s and 3 min later, screen on and off),
 * so it is there at the next boot. Needs `pm grant dev.couchtv.ontv android.permission.WRITE_SECURE_SETTINGS`
 * once over ADB; otherwise it falls back to the app's own ADB connection.
 */
object HisenseAllow {
    private const val KEY = "allowed_self_launch_3rd_packages"
    private val isHisense = android.os.Build.MANUFACTURER.equals("Hisense", ignoreCase = true)
    private val later = android.os.Handler(android.os.Looper.getMainLooper())
    private val screen = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            write(c)
            if (i.action == Intent.ACTION_SCREEN_ON) later.postDelayed({ rebindWatch(c) }, 3_000)
        }
    }

    fun start(c: Context) {
        if (!isHisense || !PlayRules.changesTvRules(BuildConfig.FLAVOR)) return   // Play: not the launch list (PlayRules)
        write(c)
        later.postDelayed({ write(c) }, 60_000)
        later.postDelayed({ rebindWatch(c) }, 10_000)
        later.postDelayed({ write(c) }, 180_000)
        runCatching {
            c.registerReceiver(screen, android.content.IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON)
            })
        }
    }

    /**
     * Android marks an accessibility service "crashed" when its process dies (Hisense kills third-party
     * processes at standby) and does not bind it again until the setting changes or the TV restarts, so
     * the Home watch stayed off. If it is enabled but not connected, write the list without it, then
     * with it again: that clears the crashed mark and binds it. Needs WRITE_SECURE_SETTINGS.
     */
    fun rebindWatch(c: Context) {
        if (WatchService.connected) return
        if (!PlayRules.mayRebind(BuildConfig.FLAVOR, Variant.agreed())) return
        if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        runCatching {
            val cr = c.contentResolver
            val key = android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            val me = "${c.packageName}/${WatchService::class.java.name}"
            val now = android.provider.Settings.Secure.getString(cr, key).orEmpty()
            val list = now.split(':').filter { it.isNotEmpty() }
            val mine = list.filter { it == me || it == "${c.packageName}/.WatchService" }
            if (mine.isEmpty()) return
            val others = list - mine.toSet()
            android.provider.Settings.Secure.putString(cr, key, (others + "${c.packageName}/.Off").joinToString(":"))
            later.postDelayed({
                runCatching {
                    android.provider.Settings.Secure.putString(cr, key, (others + me).joinToString(":"))
                    android.provider.Settings.Secure.putInt(cr, android.provider.Settings.Secure.ACCESSIBILITY_ENABLED, 1)
                    Log.w("couchtv", "hisense: home watch was not bound, bound it again")
                }
            }, 1_500)
        }.onFailure { Log.w("couchtv", "hisense rebind watch: ${it.message}") }
    }

    fun write(c: Context) {
        Thread {
            val me = c.packageName
            runCatching {
                val cr = c.contentResolver
                val now = android.provider.Settings.Global.getString(cr, KEY).orEmpty()
                val list = now.split(';').map { it.trim() }.filter { it.isNotEmpty() }
                if (me in list) return@Thread
                val want = (list + me).joinToString(";")
                if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    android.provider.Settings.Global.putString(cr, KEY, want)
                } else if (Adb.connected && want.all { it.isLetterOrDigit() || it == '.' || it == '_' || it == ';' }) {
                    // only package-name characters reach the shell (the list is read from the TV's own setting)
                    Adb.shell("settings put global $KEY '$want'", 10_000)
                } else return@Thread
                Log.i("couchtv", "hisense: kept $me in $KEY")
            }.onFailure { Log.w("couchtv", "hisense allow list: ${it.message}") }
        }.start()
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        App.startService(c)
        // Xiaomi with "Couch TV in PatchWall's place": after a restart too (the screen-on receiver is not running yet then).
        if (i.action == Intent.ACTION_BOOT_COMPLETED) FireHome.onScreenOn()
    }
}
