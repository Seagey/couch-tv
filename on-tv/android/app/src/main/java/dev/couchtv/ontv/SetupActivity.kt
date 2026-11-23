package dev.couchtv.ontv

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The Couch TV tile. A new TV gets two steps done with the TV remote alone (SetupSteps): make Couch TV the
 * home, then open it, where the home's own first-run welcome offers a design code or Couch Original. Later
 * opens show "Couch TV is ready" with Open the home and Settings. Settings holds everything else, unchanged:
 * the phone remote's QR and code, New phone code, Forget phones, Use as home screen and Stop being the home
 * screen, Make Home open Couch TV, Let the phone press keys, the computer route and every note. Typing
 * (wireless debugging code, API key, names) stays on the phone at /setup.
 */
class SetupActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var look: SetupLook
    private lateinit var screens: SetupScreens
    private lateinit var frame: FrameLayout
    private var screen = SetupSteps.Screen.READY
    /** where Settings and More help go back to */
    private var backTo = SetupSteps.Screen.READY
    private var step: SetupScreens.Step? = null

    // Settings (interim: the owner is choosing its look from mockups; every old part is here, nothing lost)
    private lateinit var settingsRoot: View
    private lateinit var settingsScroll: ScrollView
    private lateinit var phoneCard: View
    private lateinit var keysCard: View
    private lateinit var settingsBack: TextView
    private lateinit var address: TextView
    private lateinit var code: TextView
    private lateinit var next: TextView
    private lateinit var setup: TextView
    private lateinit var qr: ImageView
    private var shownUrl: String? = ""
    private lateinit var adb: TextView
    private lateinit var homeBtn: TextView
    private lateinit var homeNote: TextView
    private lateinit var openHome: TextView
    private lateinit var connect: TextView
    private lateinit var watchNote: TextView
    // Make Home open Couch TV (HomeKey.kt): the button, its line, and the help page's QR code when it needs a computer
    private lateinit var hkBtn: TextView
    private lateinit var hkLine: TextView
    private lateinit var hkQr: ImageView
    private var hkQrShown = false

    private val tick = object : Runnable { override fun run() { refresh(); main.postDelayed(this, 1500) } }
    private val pinListener: (String?) -> Unit = { main.post { refresh() } }

    // Use as home screen (HomeAsk.kt): askSince is when the home alias went on and Android is still to be
    // asked; awaitingRole is true while Android's own request is on screen; declined after it was closed
    // without Couch TV. inFront: this screen is in front, so Android's request can go out now.
    private var askSince = 0L
    private var awaitingRole = false
    private var declined = false
    private var inFront = false
    private var broughtBack = false
    // when this screen last went behind something while asking (HomeAsk.askAfterAway), and when Android's request went out (HomeAsk.answer)
    private var pausedAt = 0L
    private var askedAt = 0L
    private val ask = object : Runnable {
        override fun run() {
            if (askSince == 0L) return
            val since = System.currentTimeMillis() - askSince
            if (!HomeAsk.readyToAsk(HomeRole.aliasListed(this@SetupActivity), since, inFront && hasWindowFocus())) {
                if (inFront) main.postDelayed(this, 250)   // not in front: onResume or the window coming back asks
                return
            }
            askSince = 0L; Store.putStr(HomeAsk.PENDING_KEY, null)
            if (!HomeRole.held(this@SetupActivity)) {
                askedAt = System.currentTimeMillis()
                val asked = HomeRole.request(this@SetupActivity)
                android.util.Log.i("couchtv.homeask", "asked Android: $asked after ${since} ms")
                when (asked) {
                    HomeRole.Asked.ROLE -> awaitingRole = true
                    HomeRole.Asked.SCREEN -> {}
                    // no question on this TV: the home goes off again and step 1 says what to do
                    HomeRole.Asked.NONE -> giveUp(HomeAsk.NO_QUESTION)
                }
            }
            refresh()
        }
    }

    /**
     * Asking cannot work here (HomeAsk.LEFT or NO_QUESTION): the home goes off again unless Android made Couch TV
     * the home after all, this TV is remembered, and step 1 says what to do instead. The person stays here.
     */
    private fun giveUp(reason: String) {
        askSince = 0L; awaitingRole = false
        main.removeCallbacks(ask); main.removeCallbacks(bringBack)
        Store.putStr(HomeAsk.PENDING_KEY, null)
        if (!HomeRole.held(this)) { App.setHomeEnabled(this, false); FireHome.poke(); Store.putStr(HomeAsk.BLOCKED_KEY, reason) }
        android.util.Log.w("couchtv.homeask", "use as home screen: gave up asking ($reason)")
        updateOpenHome(); refresh()
    }

    /** What a press of Use as home screen does on this TV now (HomeAsk.plan). */
    private fun plan() = HomeAsk.plan(HomeRole.googleTv(this), HomeRole.googleHome(this), BuildConfig.BUILD_TYPE == "watch",
        HomeRole.canComeBack(this), Store.str(HomeAsk.BLOCKED_KEY))
    // Something came on top while waiting (Google's home put an empty black screen there on a TCL): bring
    // this screen back once, so the question is not left behind it. If Android does not allow that, step 1
    // says to press Back, and the question goes out when this screen is back.
    private val bringBack = Runnable {
        if (askSince > 0 && !inFront && !broughtBack && !isFinishing && !isDestroyed) {
            broughtBack = true
            runCatching { startActivity(Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
        }
    }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        App.startService(this)
        // Back from "Update to ..." (Update.kt): the shell line on the TV opens this screen once the new
        // version is on, because the home screen is not exported. The home was on screen, so it goes back there.
        if (backFromUpdate(intent)) { finish(); return }
        look = SetupLook(this); screens = SetupScreens(look)
        frame = FrameLayout(this).apply { setBackgroundColor(SetupLook.WALL) }
        setContentView(frame)
        buildSettings()
        val first = SetupSteps.firstScreen(Store.str(SetupSteps.DONE_KEY) == "1", Auth.phoneCount(), homeIsOn())
        // a TV set up before this version: remembered, so a later Stop being the home screen never brings the steps back
        if (first == SetupSteps.Screen.READY) Store.putStr(SetupSteps.DONE_KEY, "1")
        // a phone asked to pair (App.showPin): straight to the phone remote in Settings
        if (intent?.getBooleanExtra("pin", false) == true) { backTo = first; show(SetupSteps.Screen.SETTINGS, focus = "phone") }
        else show(first)
    }

    // ------------------------------------------------------------------------------------------- screens

    /** Puts a screen up. focus: "phone" or "keys" scrolls Settings to that part. */
    private fun show(s: SetupSteps.Screen, focus: String? = null) {
        if (s == SetupSteps.Screen.SETTINGS || s == SetupSteps.Screen.HOME_HELP) { if (screen != SetupSteps.Screen.SETTINGS && screen != SetupSteps.Screen.HOME_HELP) backTo = screen }
        screen = s
        frame.removeAllViews()
        step = null
        when (s) {
            SetupSteps.Screen.HOME_STEP -> step = buildHomeStep()
            SetupSteps.Screen.OPEN_STEP -> step = screens.step(2, SetupWords.OPEN_TITLE, SetupWords.OPEN_LINE, SetupWords.OPEN_BUTTON, { openTheHome() },
                chip = SetupWords.HOME_DONE, settings = { show(SetupSteps.Screen.SETTINGS) })
            SetupSteps.Screen.READY -> step = screens.step(0, SetupWords.READY_TITLE, SetupWords.readyLine(homeOpensUs()), SetupWords.OPEN_BUTTON, { openTheHome() },
                second = SetupWords.SETTINGS, onSecond = { show(SetupSteps.Screen.SETTINGS) },
                note = SetupWords.READY_NOTE_START to SetupWords.SETTINGS)
            SetupSteps.Screen.HOME_HELP -> step = screens.help(explainReason(), SetupScreens.qrBitmap(HomeKeyRules.HELP_URL),
                onKeys = { show(SetupSteps.Screen.SETTINGS, focus = "keys") }, onBack = { show(SetupSteps.Screen.HOME_STEP) })
            SetupSteps.Screen.SETTINGS -> {
                if (Auth.currentPin() == null && Auth.phoneCount() == 0) Auth.newPin()
                (settingsRoot.parent as? ViewGroup)?.removeView(settingsRoot)
                frame.addView(settingsRoot)
            }
        }
        step?.let { frame.addView(it.root) }
        refresh()
        when {
            s == SetupSteps.Screen.SETTINGS -> {
                val target = when (focus) { "phone" -> phoneCard; "keys" -> keysCard; else -> null }
                val button = when (focus) { "keys" -> connect; else -> settingsBack }
                button.requestFocus()
                target?.let { t -> settingsScroll.post { settingsScroll.smoothScrollTo(0, t.top) } } ?: settingsScroll.scrollTo(0, 0)
            }
            else -> step?.primary?.requestFocus()
        }
    }

    private fun explainReason() = SetupSteps.explainReason(plan(), HomeRole.googleHome(this), Store.str(HomeAsk.BLOCKED_KEY))

    private fun homeStepNow(): SetupSteps.HomeStep {
        val v = runCatching { org.json.JSONObject(HomeKey.state(this)).optString("view") }.getOrDefault("")
        return SetupSteps.homeStep(plan(), HomeRole.googleTv(this), BuildConfig.BUILD_TYPE == "watch", v, askSince > 0 || awaitingRole)
    }
    private var shownStep: SetupSteps.HomeStep? = null

    private fun buildHomeStep(): SetupScreens.Step {
        val k = homeStepNow(); shownStep = k
        val second = SetupWords.homeStepSecond(k)
        return screens.step(1, SetupWords.HOME_TITLE, SetupWords.homeStepLine(k, declined, explainReason()), SetupWords.homeStepButton(k), { homeStepPressed() },
            second = second, secondKind = if (k == SetupSteps.HomeStep.EXPLAIN) SetupLook.Kind.LINK else SetupLook.Kind.GHOST,
            onSecond = { if (shownStep == SetupSteps.HomeStep.EXPLAIN) show(SetupSteps.Screen.HOME_HELP) else show(SetupSteps.Screen.OPEN_STEP) },
            settings = { show(SetupSteps.Screen.SETTINGS) })
    }

    private fun homeStepPressed() {
        when (homeStepNow()) {
            SetupSteps.HomeStep.ASK, SetupSteps.HomeStep.SWITCH -> turnHomeOn()
            SetupSteps.HomeStep.KEY -> { HomeKey.start(this); refresh() }
            SetupSteps.HomeStep.EXPLAIN -> show(SetupSteps.Screen.OPEN_STEP)
            SetupSteps.HomeStep.ASKING, SetupSteps.HomeStep.BUSY -> {}
        }
    }

    /** Step 2 and the ready screen: setup is done, and the home opens (its first-run welcome takes over on a new TV). */
    private fun openTheHome() {
        Store.putStr(SetupSteps.DONE_KEY, "1")
        if (screen == SetupSteps.Screen.OPEN_STEP) show(SetupSteps.Screen.READY)
        startActivity(Intent(this, HomeActivity::class.java))
    }

    @Deprecated("Back on a TV remote")
    override fun onBackPressed() {
        when (screen) {
            SetupSteps.Screen.SETTINGS -> show(backTo)
            SetupSteps.Screen.HOME_HELP -> show(SetupSteps.Screen.HOME_STEP)
            SetupSteps.Screen.OPEN_STEP -> if (Store.str(SetupSteps.DONE_KEY) == "1") show(SetupSteps.Screen.READY) else show(SetupSteps.Screen.HOME_STEP)
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    // ------------------------------------------------------------------------------------------- Settings

    private fun buildSettings() {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(look.px(48), look.px(28), look.px(48), look.px(40)); clipChildren = false }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; clipChildren = false }
        top.addView(look.brand(), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        settingsBack = look.pill(SetupWords.BACK, SetupLook.Kind.GHOST, small = true, surface = SetupLook.WALL) { show(backTo) }
        top.addView(settingsBack)
        col.addView(top)
        col.addView(look.heading(SetupWords.SETTINGS, 34f).apply { setPadding(look.px(4), look.px(14), 0, look.px(6)) })

        fun section(title: String): LinearLayout = look.card(width = 0, padH = 36, padV = 28).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(14) }
            elevation = 0f
            addView(look.heading(title, 26f))
            col.addView(this)
        }
        fun small(t: String = "") = look.line(t, 15f).apply { setPadding(0, look.px(8), 0, 0) }
        fun button(t: String, on: () -> Unit) = look.pill(t, SetupLook.Kind.GHOST, small = true, on = on)
        fun row(vararg v: View) = look.actions(*v).apply { (layoutParams as LinearLayout.LayoutParams).topMargin = look.px(10) }

        // the phone remote: a QR code to scan, with the code and the address beside it for anyone who would rather type
        phoneCard = section("Phone remote").apply {
            val pair = LinearLayout(this@SetupActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, look.px(12), 0, 0) }
            qr = ImageView(this@SetupActivity).apply { setBackgroundColor(android.graphics.Color.WHITE) }
            pair.addView(qr, LinearLayout.LayoutParams(look.px(150), look.px(150)).apply { rightMargin = look.px(24) })
            val words = LinearLayout(this@SetupActivity).apply { orientation = LinearLayout.VERTICAL }
            code = look.heading("", 30f); words.addView(code)
            next = small(); words.addView(next)
            address = small().apply { setTextColor(SetupLook.INK) }; words.addView(address)
            pair.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(pair)
            // someone with the TV remote is here: every pairing lock opens (Auth.resetLocks), then a new code
            addView(row(button("New phone code") { Auth.resetLocks(); Auth.newPin(); refresh() }, button("Forget phones") { Auth.forgetAll(); refresh() }))
        }

        section("Home button").apply {
            homeNote = small(); addView(homeNote)
            // The way to the home page on a TV where Google's home keeps the Home button. Only shows when the Home
            // button does not already open Couch TV (see homeOpensUs). HomeActivity applies Kids mode itself.
            openHome = button(SetupWords.OPEN_BUTTON) { startActivity(Intent(this@SetupActivity, HomeActivity::class.java)) }
            homeBtn = button("") { homeButtonPressed() }
            addView(row(openHome, homeBtn))
            // the button (only while one press can do it) and its words, with the help page's QR when it needs a computer
            val hk = LinearLayout(this@SetupActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val hkWords = LinearLayout(this@SetupActivity).apply { orientation = LinearLayout.VERTICAL }
            hkBtn = button(HomeKeyRules.BUTTON) { HomeKey.start(this@SetupActivity); refresh() }.apply { visibility = View.GONE }
            hkWords.addView(look.actions(hkBtn))
            hkLine = small().apply { setTextColor(SetupLook.INK) }; hkWords.addView(hkLine)
            hk.addView(hkWords, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            hkQr = ImageView(this@SetupActivity).apply { visibility = View.GONE }
            hk.addView(hkQr, LinearLayout.LayoutParams(look.px(130), look.px(130)).apply { leftMargin = look.px(20) })
            addView(hk)
            // the phone only download: the exact way to the Home button watch, from a computer (SetupWords.watchSteps)
            watchNote = small()
            if (BuildConfig.BUILD_TYPE != "watch") addView(look.heading("Home button from a computer", 20f).apply { setPadding(0, look.px(16), 0, 0) })
            if (BuildConfig.BUILD_TYPE != "watch") addView(watchNote)
        }

        // the tools for the arrow keys and typing from the phone, in plain words
        keysCard = section("Let the phone press keys").apply {
            adb = small(); addView(adb)
            connect = button("Let the phone press keys") { adb.text = "Connecting. If the TV asks \"Allow debugging?\", tick Always allow and press OK."; Thread { Adb.ensure(interactive = true); main.post { refresh() } }.start() }
            val dev = button("Open Developer options") { runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) } }
            // the home watch is only in couch-tv-ontv-watch.apk (installed from a computer): Play Protect blocks it in a phone only install
            if (BuildConfig.BUILD_TYPE == "watch") addView(row(connect, dev, button("Keep Couch TV on Home") { runCatching { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) } }))
            else addView(row(connect, dev))
            addView(small("For the arrow keys and typing from your phone, the TV has to let Couch TV press keys. One time only: " +
                "on the TV open Settings, then System (or Device Preferences), then About, and press OK on Android TV OS build (on some TVs, Build) seven times. " +
                "Then in Developer options switch on USB debugging, and Network debugging or Wireless debugging if the TV has one. " +
                "These let Couch TV press keys on this TV. Only a device you press Allow for can use them. " +
                "Come back here and press Let the phone press keys, then Allow on the TV. " +
                (if (android.os.Build.VERSION.SDK_INT >= 33) "This TV runs Android 13 or newer: use Wireless debugging, then Pair device with pairing code, and type that code on your phone, in Home settings, Let the phone press keys. " else "") +
                "Careful: never press Revoke USB debugging authorizations."))
        }

        section("Phone or computer setup").apply {
            setup = small(); addView(setup)
        }
        section("Good to know").apply {
            addView(small("The phone remote runs on this TV. No computer needed."))
            addView(small("Couch TV cannot turn the TV on: once the TV sleeps, this app sleeps too. Use the TV's own remote."))
        }
        settingsScroll = ScrollView(this).apply { setBackgroundColor(SetupLook.WALL); clipChildren = false; addView(col) }
        settingsRoot = settingsScroll
        updateOpenHome()
    }

    /** Settings, Use as home screen / Stop being the home screen: the old button, unchanged. */
    private fun homeButtonPressed() {
        if (askSince > 0) return   // already asking
        // what Android reports now decides (HomeAsk.isOn): a switch left on while the TV's own home is the
        // default asks again instead of switching off
        val on = !homeIsOn()
        declined = false
        if (on) turnHomeOn() else { App.setHomeEnabled(this, false); FireHome.poke(); refresh(); updateOpenHome() }
    }

    /**
     * Switches the home on and asks Android where it can. A TV that cannot be asked from here (Google's Android
     * TV Home without "draw over apps", or a TV that had no question before): change nothing and stay here, step 1
     * says what to do (TCL, 23 Nov 2026: switching the home on put Google's home in front and this screen never came back).
     */
    private fun turnHomeOn() {
        if (askSince > 0) return
        declined = false
        val plan = plan()
        android.util.Log.i("couchtv.homeask", "use as home screen pressed: $plan")
        if (plan == HomeAsk.Plan.EXPLAIN) { if (App.homeEnabled(this)) App.setHomeEnabled(this, false); refresh(); updateOpenHome(); return }
        App.setHomeEnabled(this, true); FireHome.poke()
        // No computer: Android's own "default home app" request (plain Android TV 10+), else its Home settings.
        // Not at once: Android needs a moment to take in the alias just switched on (HomeAsk.kt).
        if (plan == HomeAsk.Plan.ASK && !HomeRole.held(this)) {
            askSince = System.currentTimeMillis(); broughtBack = false; pausedAt = 0L
            // kept, so a setup screen Android closes while it is behind another home is noticed when Couch TV opens again
            Store.putStr(HomeAsk.PENDING_KEY, askSince.toString())
            main.post(ask)
        }
        refresh(); updateOpenHome()
    }

    // ------------------------------------------------------------------------------------------- Android

    override fun onResume() {
        super.onResume(); inFront = true
        Auth.onPin(pinListener); main.post(tick); updateOpenHome()
        if (askSince > 0) {
            // back in front: brought back (or Back on a black screen) soon enough asks; much later, the person found
            // their own way back from the TV's home, so asking again would only send them there again
            val away = if (pausedAt > 0) System.currentTimeMillis() - pausedAt else 0L
            if (HomeAsk.askAfterAway(away)) { main.removeCallbacks(ask); main.post(ask) } else giveUp(HomeAsk.LEFT)
        } else if (Store.str(HomeAsk.PENDING_KEY) != null) {
            // a setup screen that was waiting to ask is gone (Android closed it while it was behind the TV's home)
            giveUp(HomeAsk.LEFT)
        }
    }
    override fun onPause() {
        super.onPause(); inFront = false
        Auth.offPin(pinListener); main.removeCallbacks(tick)
        if (askSince > 0) { pausedAt = System.currentTimeMillis(); main.postDelayed(bringBack, 1500) }
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
    @Deprecated("Android's own home question answers here")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == HomeRole.REQUEST && awaitingRole) {
            awaitingRole = false
            // Android's answer decides, not the button press: Cancel (or Back) leaves the TV's home as it was,
            // so the alias goes off again and step 1 asks again. An answer quicker than anyone could read means
            // Android showed nothing: then step 1 says what this TV allows instead.
            val held = HomeRole.held(this)
            val answer = HomeAsk.answer(held, System.currentTimeMillis() - askedAt)
            android.util.Log.i("couchtv.homeask", "Android answered $resultCode: $answer after ${System.currentTimeMillis() - askedAt} ms")
            when (answer) {
                HomeAsk.Answer.HOME -> Store.putStr(HomeAsk.BLOCKED_KEY, null)
                HomeAsk.Answer.NO_QUESTION -> giveUp(HomeAsk.NO_QUESTION)
                HomeAsk.Answer.DECLINED -> if (!HomeAsk.keepAliasOn(held)) { App.setHomeEnabled(this, false); FireHome.poke(); declined = true }
            }
            updateOpenHome()
        }
        refresh()
    }
    override fun onNewIntent(i: Intent) {
        super.onNewIntent(i)
        if (backFromUpdate(i)) return
        if (i.getBooleanExtra("pin", false)) show(SetupSteps.Screen.SETTINGS, focus = "phone") else refresh()
    }

    /** Opens the home when the intent comes from the update's shell line, once (the extra goes). */
    private fun backFromUpdate(i: Intent?): Boolean {
        if (i?.getBooleanExtra("updated", false) != true) return false
        i.removeExtra("updated")
        startActivity(Intent(this, HomeActivity::class.java))
        return true
    }

    private fun homeIsOn(): Boolean = HomeAsk.isOn(App.homeEnabled(this), HomeRole.held(this), homeOpensUs(), HomeRole.googleTv(this))

    /** True when the TV's Home button already opens this app (the HomeAlias), so Open the home in Settings would be redundant. */
    private fun homeOpensUs(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val pkg = runCatching { packageManager.resolveActivity(home, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName }.getOrNull()
        return pkg == packageName
    }

    /** Settings shows Open the home only when Home does not open Couch TV; GONE keeps the D pad order gap free. */
    private fun updateOpenHome() {
        if (!::openHome.isInitialized) return
        val show = !homeOpensUs()
        val hadFocus = openHome.hasFocus()
        openHome.visibility = if (show) View.VISIBLE else View.GONE
        if (!show && hadFocus) homeBtn.requestFocus()
    }

    private fun refresh() {
        if (!::frame.isInitialized) return
        refreshStep()
        refreshSettings()
    }

    /** The step screen's words and buttons, from what Android and HomeKey report now. */
    private fun refreshStep() {
        val s = step ?: return
        when (screen) {
            SetupSteps.Screen.HOME_STEP -> {
                // Couch TV is the home now: on to step 2
                if (SetupSteps.stepOneDone(homeIsOn())) { show(SetupSteps.Screen.OPEN_STEP); return }
                val k = homeStepNow()
                // what the press offers changed (asking, a give up, HomeKey busy): build it again, keeping the focus where it was
                if (k != shownStep) {
                    val secondHad = s.second?.hasFocus() == true; val cornerHad = s.settings?.hasFocus() == true
                    frame.removeAllViews(); step = buildHomeStep(); frame.addView(step!!.root)
                    when { secondHad -> step!!.second?.requestFocus(); cornerHad -> step!!.settings?.requestFocus(); else -> step!!.primary.requestFocus() }
                    return
                }
                val busy = if (k == SetupSteps.HomeStep.BUSY) runCatching { org.json.JSONObject(HomeKey.state(this)).optString("words") }.getOrDefault("") else ""
                s.line.text = SetupWords.homeStepLine(k, declined && !App.homeEnabled(this), explainReason(), busy)
                s.primary.alpha = if (k == SetupSteps.HomeStep.ASKING || k == SetupSteps.HomeStep.BUSY) 0.6f else 1f
            }
            SetupSteps.Screen.OPEN_STEP -> s.chip?.visibility = if (homeIsOn()) View.VISIBLE else View.GONE
            SetupSteps.Screen.READY -> s.line.text = SetupWords.readyLine(homeOpensUs())
            else -> {}
        }
    }

    private fun refreshSettings() {
        val ip = App.lanAddress()
        val phoneUrl = if (ip != null) "http://$ip:${Store.port}" else null
        // locked for every phone (Auth.lockedEverywhere): no code that would be refused, the lock and its time instead
        val locked = Auth.lockedEverywhere()
        val p = if (locked > 0) null else Auth.currentPin()
        // one scan pairs: while a code is live it rides in the QR's #fragment (never sent to the TV in
        // a request line, so never in a log); the phone page pairs with it at once (shim.js)
        val qrText = SetupWords.qrLink(phoneUrl, p)
        if (qrText != shownUrl) {
            shownUrl = qrText
            qr.setImageBitmap(qrText?.let { SetupScreens.qrBitmap(it) })
            qr.visibility = if (qrText != null) View.VISIBLE else View.GONE
        }
        address.text = if (phoneUrl != null) "Or type  $phoneUrl" else "This TV is not on a network yet. Connect it to Wi-Fi first."
        setup.text = if (phoneUrl != null) "Home settings on your phone or computer, on the same Wi-Fi:  $phoneUrl/setup" else "This TV is not on a network yet. Connect it to Wi-Fi first."
        val ago = Auth.lastPairedAt.takeIf { it > 0 }?.let { System.currentTimeMillis() - it }
        code.text = SetupWords.pairLine(p, Auth.phoneCount(), ago, locked)
        next.text = SetupWords.nextLine(p, Auth.phoneCount(), homeOpensUs(), locked)
        val s = Adb.status()
        adb.text = SetupWords.keysLine(Adb.connected, s["state"] == "waiting_for_allow" || s["state"] == "connecting", s["state"] == "needs_pairing", Adb.unanswered)
        val google = HomeRole.googleTv(this)
        val watchApk = BuildConfig.BUILD_TYPE == "watch"
        val asking = askSince > 0 || awaitingRole
        // read from Android on every refresh (each 1.5 s and on resume), never from a saved flag alone
        val held = HomeRole.held(this)
        val opensUs = homeOpensUs()
        homeBtn.text = HomeAsk.buttonLabel(HomeAsk.isOn(App.homeEnabled(this), held, opensUs, google), asking)
        homeBtn.visibility = if (HomeAsk.showButton(google, watchApk, App.homeEnabled(this))) View.VISIBLE else View.GONE
        val googleHome = HomeRole.googleHome(this)
        val blocked = Store.str(HomeAsk.BLOCKED_KEY)
        homeNote.text = SetupWords.homeNote(App.homeEnabled(this), held, google, watchApk = watchApk,
            googleHome = googleHome, asking = asking, declined = declined && !App.homeEnabled(this), opensUs = opensUs,
            noAsk = HomeAsk.noAskReason(plan(), googleHome, blocked))
        if (!watchApk) watchNote.text = SetupWords.watchSteps(ip)
        showHomeKey()
    }

    /** Make Home open Couch TV: the button while one press can do it, the words, and the help page's QR when it needs a computer. */
    private fun showHomeKey() {
        val s = org.json.JSONObject(HomeKey.state(this))
        val v = s.optString("view")
        val hadFocus = hkBtn.hasFocus()
        hkBtn.visibility = if (v == "ready" || v == "busy") View.VISIBLE else View.GONE
        // never disabled: a disabled button loses the D pad focus. Dimmed while busy; HomeKey.start ignores a second press.
        hkBtn.alpha = if (v == "ready") 1f else 0.5f
        if (hadFocus && hkBtn.visibility != View.VISIBLE) homeBtn.requestFocus()
        val err = s.optString("error_words")
        // a failed press on the ready view: the reason alone (with the ready words too it runs to four lines)
        hkLine.text = if (err.isNotEmpty() && v == "ready") err else listOf(err, s.optString("words")).filter { it.isNotEmpty() }.joinToString(" ")
        hkLine.visibility = if (hkLine.text.isEmpty()) View.GONE else View.VISIBLE
        val wantQr = v == "steps"
        if (wantQr && !hkQrShown) SetupScreens.qrBitmap(HomeKeyRules.HELP_URL)?.let { hkQr.setImageBitmap(it); hkQrShown = true }
        hkQr.visibility = if (wantQr && hkQrShown) View.VISIBLE else View.GONE
    }
}
