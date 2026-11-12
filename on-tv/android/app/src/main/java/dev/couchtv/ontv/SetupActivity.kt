package dev.couchtv.ontv

import android.app.Activity
import android.content.Intent
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
    private lateinit var adb: TextView
    private lateinit var homeBtn: Button
    private lateinit var homeNote: TextView
    private lateinit var openHome: Button
    private lateinit var connect: Button
    private val tick = object : Runnable { override fun run() { refresh(); main.postDelayed(this, 1500) } }
    private val pinListener: (String?) -> Unit = { main.post { refresh() } }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        App.startService(this)
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(px(56), px(36), px(56), px(36)) }
        fun text(t: String, size: Float, colour: Int = CREAM, bold: Boolean = false) = TextView(this).apply {
            text = t; textSize = size; setTextColor(colour); if (bold) typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
            setPadding(0, px(4), 0, px(4))
        }
        col.addView(text("Couch TV", 34f, CREAM, true))
        col.addView(text("The phone remote runs on this TV. No computer needed.", 16f, CREAM_2))
        address = text("", 22f, AMBER, true); col.addView(address)
        code = text("", 44f, CREAM, true); col.addView(code)
        adb = text("", 16f, CREAM_2); col.addView(adb)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, px(16), 0, 0) }
        fun button(t: String, on: () -> Unit) = Button(this).apply {
            text = t; isAllCaps = false; textSize = 15f; setTextColor(CREAM)
            background = GradientDrawable().apply { setColor(FLAP); cornerRadius = px(6).toFloat() }
            setOnFocusChangeListener { v, has -> (v.background as GradientDrawable).setStroke(if (has) px(3) else 0, AMBER) }
            setOnClickListener { on() }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { rightMargin = px(12) }
        }
        // The Couch TV tile opens this screen, so this is the way to the home page on a TV (Google TV) where Google's home keeps the Home button.
        // It only shows when the Home button does not already open couch-tv (see homeOpensUs).
        // HomeActivity is in this app, and it applies Kids mode itself, so this is no route around it.
        openHome = button("Open the home") { startActivity(Intent(this, HomeActivity::class.java)) }
        row.addView(openHome)
        connect = button("Connect ADB") { adb.text = "Connecting. If the TV asks \"Allow debugging?\", tick Always allow and press OK."; Thread { Adb.ensure(interactive = true); main.post { refresh() } }.start() }
        row.addView(connect)
        row.addView(button("New phone code") { Auth.newPin(); refresh() })
        row.addView(button("Developer options") { runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) } })
        homeBtn = button("") {
            val on = !App.homeEnabled(this)
            App.setHomeEnabled(this, on); FireHome.poke()
            // No computer: Android's own "default home app" request (plain Android TV 10+), else its Home chooser
            if (on && !HomeRole.googleTv(this) && !HomeRole.held(this)) HomeRole.request(this)
            refresh(); updateOpenHome()
        }
        row.addView(homeBtn)
        // The Home key on some TVs opens the maker's own home and ignores the default home: this watch brings couch-tv back.
        row.addView(button("Home button watch") { runCatching { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) } })
        row.addView(button("Forget phones") { Auth.forgetAll(); refresh() })
        col.addView(row)
        homeNote = text("", 14f, CREAM_2); col.addView(homeNote)
        col.addView(text((if (android.os.Build.VERSION.SDK_INT >= 33) "This TV runs Android 13 or newer, so use wireless debugging pairing (Connect ADB may never get an answer). " else "") +
            "Wireless debugging (Android 11 and newer, TV on Wi-Fi): Developer options > Wireless debugging > on, allow this network, then " +
            "Pair device with pairing code, and type that code on your phone at the setup page while the code stays on screen. " +
            "Careful: Revoke USB debugging authorizations sits right next to Wireless debugging; never press OK on it.", 14f, CREAM_2).apply { setPadding(0, px(18), 0, 0) })
        col.addView(text("Turning the TV on is not possible from the TV itself: once it sleeps, this app sleeps too. Use the TV's own remote.", 14f, CREAM_2))
        setContentView(ScrollView(this).apply { setBackgroundColor(GROUND); addView(col) })
        updateOpenHome()
        if (Auth.currentPin() == null) Auth.newPin()
    }

    override fun onResume() { super.onResume(); Auth.onPin(pinListener); main.post(tick); updateOpenHome() }
    override fun onPause() { super.onPause(); Auth.offPin(pinListener); main.removeCallbacks(tick) }
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data); refresh()
    }
    override fun onNewIntent(i: Intent) { super.onNewIntent(i); refresh() }

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
        else if (hadFocus || currentFocus == null) connect.requestFocus()
    }

    private fun refresh() {
        val ip = App.lanAddress()
        address.text = if (ip != null) "On your phone open  http://$ip:${Store.port}\nSetup page  http://$ip:${Store.port}/setup" else "Not on a network yet"
        val p = Auth.currentPin()
        code.text = if (p != null) "Phone code  ${p.take(3)} ${p.drop(3)}" else "Phone code: press New phone code"
        code.visibility = View.VISIBLE
        val s = Adb.status()
        adb.text = "ADB: " + when {
            Adb.connected -> "connected (${Adb.route}). Keys, typing and \"what's playing\" work."
            s["state"] == "waiting_for_allow" || s["state"] == "connecting" -> "waiting. Accept \"Allow debugging?\" on the TV."
            s["state"] == "needs_pairing" -> "not set up. Pair wireless debugging from the phone setup page."
            else -> "off. Opening apps and volume still work; keys need ADB." + (Adb.lastError?.let { "\n($it)" } ?: "")
        } + "   Phones paired: ${Auth.phoneCount()}"
        homeBtn.text = if (App.homeEnabled(this)) "Stop being the home screen" else "Use as home screen"
        homeNote.text = when {
            !App.homeEnabled(this) -> "Use as home screen asks Android to make Couch TV your home. No computer needed on a plain Android TV."
            HomeRole.held(this) -> "Couch TV is your home screen."
            HomeRole.googleTv(this) -> "On Google TV, Google's home keeps the Home button. Open Couch TV from here with Open the home (it shows when Home does not open Couch TV), or use the TV home install (apply.sh) for the Home button."
            else -> "If Android showed a list, choose Couch TV and press Always. If Home still opens the TV's own home, press Home button watch and switch on Couch TV home watch."
        }
    }

    companion object {
        private val GROUND = Color.parseColor("#0D1E19")
        private val FLAP = Color.parseColor("#131614")
        private val CREAM = Color.parseColor("#F2EAD8")
        private val CREAM_2 = Color.parseColor("#BDB6A7")
        private val AMBER = Color.parseColor("#FFB52E")
    }
}
