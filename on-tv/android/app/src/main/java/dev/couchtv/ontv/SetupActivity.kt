package dev.couchtv.ontv

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The setup screen on the TV (the "Couch TV" tile). Shows the address to open on a phone, the
 * pairing code, and the state of ADB. Everything with typing (wireless debugging code, API key,
 * names) is done on the phone at /setup, because typing with a TV remote is miserable.
 */
class SetupActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var address: TextView
    private lateinit var code: TextView
    private lateinit var next: TextView
    private lateinit var setup: TextView
    private lateinit var qr: ImageView
    private lateinit var more: LinearLayout
    private lateinit var moreBtn: Button
    private var shownUrl: String? = ""
    private lateinit var adb: TextView
    private lateinit var homeBtn: Button
    private lateinit var homeNote: TextView
    private lateinit var openHome: Button
    private lateinit var connect: Button
    private val tick = object : Runnable { override fun run() { refresh(); main.postDelayed(this, 1500) } }
    private val pinListener: (String?) -> Unit = { main.post { refresh() } }
    private lateinit var watchNote: TextView

    // Use as home screen (HomeAsk.kt): askSince is when the home alias went on and Android is still to be
    // asked; awaitingRole is true while Android's own request is on screen; declined after it was closed
    // without Couch TV. inFront: this screen is in front, so Android's request can go out now.
    private var askSince = 0L
    private var awaitingRole = false
    private var declined = false
    private var inFront = false
    private var broughtBack = false
    private val ask = object : Runnable {
        override fun run() {
            if (askSince == 0L) return
            val since = System.currentTimeMillis() - askSince
            if (!HomeAsk.readyToAsk(HomeRole.aliasListed(this@SetupActivity), since, inFront && hasWindowFocus())) {
                if (inFront) main.postDelayed(this, 250)   // not in front: onResume or the window coming back asks
                return
            }
            askSince = 0L
            if (!HomeRole.held(this@SetupActivity)) awaitingRole = HomeRole.request(this@SetupActivity) == HomeRole.Asked.ROLE
            refresh()
        }
    }
    // Something came on top while waiting (Google's home put an empty black screen there on a TCL): bring
    // this screen back once, so the question is not left behind it. If Android does not allow that, the
    // note says to press Back, and the question goes out when this screen is back.
    private val bringBack = Runnable {
        if (askSince > 0 && !inFront && !broughtBack && !isFinishing && !isDestroyed) {
            broughtBack = true
            runCatching { startActivity(Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
        }
    }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        App.startService(this)
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(px(56), px(32), px(56), px(32)) }
        fun text(t: String, size: Float, colour: Int = CREAM, bold: Boolean = false) = TextView(this).apply {
            text = t; textSize = size; setTextColor(colour); if (bold) typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
            setPadding(0, px(4), 0, px(4))
        }
        col.addView(text("Couch TV", 34f, CREAM, true))
        col.addView(text("The phone remote runs on this TV. No computer needed.", 16f, CREAM_2))

        // the phone's way in: a QR code to scan, with the address under it for anyone who would rather type
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, px(14), 0, 0); gravity = Gravity.CENTER_VERTICAL }
        qr = ImageView(this).apply { layoutParams = LinearLayout.LayoutParams(px(150), px(150)).apply { rightMargin = px(28) } }
        top.addView(qr)
        val words = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        code = text("", 40f, CREAM, true); words.addView(code)
        next = text("", 17f, CREAM); words.addView(next)
        address = text("", 17f, AMBER, true); words.addView(address)
        top.addView(words)
        col.addView(top)
        adb = text("", 15f, CREAM_2); col.addView(adb)

        fun button(t: String, on: () -> Unit) = Button(this).apply {
            text = t; isAllCaps = false; textSize = 15f; setTextColor(CREAM); setSingleLine(true); maxLines = 1
            background = GradientDrawable().apply { setColor(FLAP); cornerRadius = px(6).toFloat() }
            setPadding(px(18), px(10), px(18), px(10))
            setOnFocusChangeListener { v, has -> (v.background as GradientDrawable).setStroke(if (has) px(3) else 0, AMBER) }
            setOnClickListener { on() }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { rightMargin = px(12) }
        }
        fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, px(14), 0, 0) }
        val main1 = row()
        // The Couch TV tile opens this screen, so this is the way to the home page on a TV (Google TV) where Google's home keeps the Home button.
        // It only shows when the Home button does not already open couch-tv (see homeOpensUs).
        // HomeActivity is in this app, and it applies Kids mode itself, so this is no route around it.
        openHome = button("Open the home") { startActivity(Intent(this, HomeActivity::class.java)) }
        main1.addView(openHome)
        main1.addView(button("New phone code") { Auth.newPin(); refresh() })
        homeBtn = button("") {
            if (askSince > 0) return@button   // already asking
            // what Android reports now decides (HomeAsk.isOn): a switch left on while the TV's own home is the
            // default asks again instead of switching off
            val on = !homeIsOn()
            declined = false
            App.setHomeEnabled(this, on); FireHome.poke()
            // No computer: Android's own "default home app" request (plain Android TV 10+), else its Home chooser.
            // Not at once: Android needs a moment to take in the alias just switched on (HomeAsk.kt).
            if (on && !HomeRole.googleTv(this) && !HomeRole.held(this)) { askSince = System.currentTimeMillis(); broughtBack = false; main.post(ask) }
            refresh(); updateOpenHome()
        }
        main1.addView(homeBtn)
        moreBtn = button("More") { more.visibility = if (more.visibility == View.VISIBLE) View.GONE else View.VISIBLE; refresh() }
        main1.addView(moreBtn)
        col.addView(main1)
        homeNote = text("", 15f, CREAM_2); col.addView(homeNote)

        // More: the tools for the arrow keys and typing from the phone, in plain words, out of a beginner's way
        more = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        val more1 = row()
        connect = button("Let the phone press keys") { adb.text = "Connecting. If the TV asks \"Allow debugging?\", tick Always allow and press OK."; Thread { Adb.ensure(interactive = true); main.post { refresh() } }.start() }
        more1.addView(connect)
        more1.addView(button("TV developer settings") { runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) } })
        // the home watch is only in couch-tv-ontv-watch.apk (installed from a computer): Play Protect blocks it in a phone only install
        if (BuildConfig.BUILD_TYPE == "watch") more1.addView(button("Keep couch-tv on Home") { runCatching { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) } })
        more1.addView(button("Forget phones") { Auth.forgetAll(); refresh() })
        more.addView(more1)
        more.addView(text("For the arrow keys and typing from your phone, the TV has to let Couch TV press keys. One time only: " +
            "on the TV open Settings, then System (or Device Preferences), then About, and press OK on Build seven times. " +
            "Then in Developer options switch on USB debugging, and Network debugging or Wireless debugging if the TV has one. " +
            "Come back here and press Let the phone press keys, then Allow on the TV. " +
            (if (android.os.Build.VERSION.SDK_INT >= 33) "This TV runs Android 13 or newer: use Wireless debugging, then Pair device with pairing code, and type that code on your phone at the setup page. " else "") +
            "Careful: never press Revoke USB debugging authorisations.", 14f, CREAM_2).apply { setPadding(0, px(14), 0, 0) })
        more.addView(text("Couch TV cannot turn the TV on: once the TV sleeps, this app sleeps too. Use the TV's own remote.", 14f, CREAM_2))
        // the phone only download: the exact way to the Home button watch, from a computer (SetupWords.watchSteps)
        watchNote = text("", 14f, CREAM_2).apply { setPadding(0, px(10), 0, 0) }
        if (BuildConfig.BUILD_TYPE != "watch") more.addView(watchNote)
        setup = text("", 14f, AMBER); more.addView(setup)
        col.addView(more)
        setContentView(ScrollView(this).apply { setBackgroundColor(GROUND); addView(col) })
        updateOpenHome()
        if (Auth.currentPin() == null && Auth.phoneCount() == 0) Auth.newPin()
    }

    override fun onResume() {
        super.onResume(); inFront = true
        Auth.onPin(pinListener); main.post(tick); updateOpenHome()
        if (askSince > 0) { main.removeCallbacks(ask); main.post(ask) }
    }
    override fun onPause() {
        super.onPause(); inFront = false
        Auth.offPin(pinListener); main.removeCallbacks(tick)
        if (askSince > 0) main.postDelayed(bringBack, 1500)
    }
    override fun onDestroy() {
        // nothing left to ask or to bring back once this screen is gone (bringBack would reopen it)
        askSince = 0L
        main.removeCallbacks(ask); main.removeCallbacks(bringBack); main.removeCallbacks(tick)
        super.onDestroy()
    }
    override fun onWindowFocusChanged(has: Boolean) {
        super.onWindowFocusChanged(has)
        if (has && askSince > 0) { main.removeCallbacks(ask); main.post(ask) }
    }
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == HomeRole.REQUEST && awaitingRole) {
            awaitingRole = false
            // Android's answer decides, not the button press: Cancel (or Back) leaves the TV's home as it was,
            // so the alias goes off again and the button says Use as home screen.
            if (!HomeAsk.keepAliasOn(HomeRole.held(this))) { App.setHomeEnabled(this, false); FireHome.poke(); declined = true }
            updateOpenHome()
        }
        refresh()
    }
    override fun onNewIntent(i: Intent) { super.onNewIntent(i); refresh() }

    private fun homeIsOn(): Boolean = HomeAsk.isOn(App.homeEnabled(this), HomeRole.held(this), homeOpensUs(), HomeRole.googleTv(this))

    /** True when the TV's Home button already opens this app (the HomeAlias), so Open the home would be redundant. */
    private fun homeOpensUs(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val pkg = runCatching { packageManager.resolveActivity(home, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName }.getOrNull()
        return pkg == packageName
    }

    /** Shows Open the home only when Home does not open couch-tv; GONE keeps the D pad order gap free. */
    private fun updateOpenHome() {
        val show = !homeOpensUs()
        val hadFocus = openHome.hasFocus()
        openHome.visibility = if (show) View.VISIBLE else View.GONE
        if (show) { if (currentFocus == null) openHome.requestFocus() }
        else if (hadFocus || currentFocus == null) moreBtn.requestFocus()
    }

    private fun refresh() {
        val ip = App.lanAddress()
        val phoneUrl = if (ip != null) "http://$ip:${Store.port}" else null
        if (phoneUrl != shownUrl) {
            shownUrl = phoneUrl
            qr.setImageBitmap(phoneUrl?.let { qrBitmap(it) })
            qr.visibility = if (phoneUrl != null) View.VISIBLE else View.GONE
        }
        address.text = if (phoneUrl != null) "Or type  $phoneUrl" else "This TV is not on a network yet. Connect it to Wi-Fi first."
        setup.text = if (phoneUrl != null) "Setup page for the phone:  $phoneUrl/setup" else ""
        val p = Auth.currentPin()
        val ago = Auth.lastPairedAt.takeIf { it > 0 }?.let { System.currentTimeMillis() - it }
        code.text = SetupWords.pairLine(p, Auth.phoneCount(), ago)
        next.text = SetupWords.nextLine(p, Auth.phoneCount(), homeOpensUs())
        val s = Adb.status()
        adb.text = SetupWords.keysLine(Adb.connected, s["state"] == "waiting_for_allow" || s["state"] == "connecting", s["state"] == "needs_pairing")
        val google = HomeRole.googleTv(this)
        val watchApk = BuildConfig.BUILD_TYPE == "watch"
        val asking = askSince > 0 || awaitingRole
        // read from Android on every refresh (each 1.5 s and on resume), never from a saved flag alone
        val held = HomeRole.held(this)
        val opensUs = homeOpensUs()
        homeBtn.text = HomeAsk.buttonLabel(HomeAsk.isOn(App.homeEnabled(this), held, opensUs, google), asking)
        homeBtn.visibility = if (HomeAsk.showButton(google, watchApk, App.homeEnabled(this))) View.VISIBLE else View.GONE
        homeNote.text = SetupWords.homeNote(App.homeEnabled(this), held, google, watchApk = watchApk,
            googleHome = HomeRole.googleHome(this), asking = asking, declined = declined && !App.homeEnabled(this), opensUs = opensUs)
        if (!watchApk) watchNote.text = SetupWords.watchSteps(ip)
    }

    /** The phone address as a QR code (Qr.kt, the same code as the home page draws), black on white with a quiet zone. */
    private fun qrBitmap(text: String): Bitmap? = runCatching {
        val m = Qr.matrix(text); val q = 4; val n = m.size + q * 2; val scale = 8
        val bmp = Bitmap.createBitmap(n * scale, n * scale, Bitmap.Config.RGB_565)
        bmp.eraseColor(Color.WHITE)
        for (y in m.indices) for (x in m.indices) if (m[y][x]) for (dy in 0 until scale) for (dx in 0 until scale) bmp.setPixel((x + q) * scale + dx, (y + q) * scale + dy, Color.BLACK)
        bmp
    }.getOrNull()

    companion object {
        private val GROUND = Color.parseColor("#0D1E19")
        private val FLAP = Color.parseColor("#131614")
        private val CREAM = Color.parseColor("#F2EAD8")
        private val CREAM_2 = Color.parseColor("#BDB6A7")
        private val AMBER = Color.parseColor("#FFB52E")
    }
}
