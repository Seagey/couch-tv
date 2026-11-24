package dev.couchtv.ontv

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The Couch TV tile. A new TV gets two steps done with the TV remote alone (SetupSteps): make Couch TV the
 * home, then open it, where the home's own first-run welcome offers a design code or Couch Original. Later
 * opens show "Couch TV is ready" with Open the home and Settings.
 *
 * Settings (SettingsScreen, SetupSettings; owner approved round 2, 23 Nov 2026) is a list and a panel:
 * Edit your home (a QR to the phone page, where widgets, the town, calendars and photos are set), Phone
 * remote (pictures of the real phone remote, the pairing QR and code, New code, Forget phones, and the key
 * walk-through only on a TV that still needs it), Undo Couch TV (back to the TV's own home, the watch off,
 * then Android's own uninstall question) and Help (a QR to the help site). Typing (the wireless debugging
 * code, the API key, names) stays on the phone at /setup.
 */
class SetupActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var look: SetupLook
    private lateinit var screens: SetupScreens
    private lateinit var frame: FrameLayout
    private var screen = SetupSteps.Screen.READY
    /** where Settings and More help go back to */
    private var backTo = SetupSteps.Screen.READY
    private var fromHome = false   // opened by the home's gear menu, Phone remote: Back from Settings goes back to the home

    companion object {
        /** Intent extra: open on Settings, Phone remote (HomeActivity.openPhoneRemote, the home's gear menu). */
        const val PHONE_REMOTE = "phone_remote"
    }
    private var step: SetupScreens.Step? = null

    private lateinit var settings: SettingsScreen
    private var editShown: String? = ""
    private var phoneShown: String? = ""
    /** the key walk-through: which screen of SetupSettings.keySteps, and its status line on the last one */
    private var keyIndex = 0
    private var keyStatus: TextView? = null
    // the wait for the TV's "Allow USB debugging?" box after Connect (AllowWait): when it started, whether something
    // came over this screen in it (the box), whether the app stepped aside once, and whether the hidden line is up
    private var waitStartedAt = 0L
    /** when the setup screen first saw Adb waiting for Allow in this wait (0: not yet) */
    private var allowSince = 0L
    private var waitLostFocus = false
    private var steppedAside = false
    private var hiddenShown = false

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
        refresh()
    }

    /** What a press of Make it my home does on this TV now (HomeAsk.plan). */
    private fun plan() = HomeAsk.plan(HomeRole.googleTv(this), HomeRole.googleHome(this), Variant.hasWatch,
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
        settings = SettingsScreen(look, object : SettingsScreen.Actions {
            override fun newCode() { Auth.resetLocks(); Auth.newPin(); refresh() }   // someone with the TV remote is here: every pairing lock opens
            override fun forgetPhones() { Auth.forgetAll(); refresh() }
            override fun keys() { keyIndex = firstKeyStep(); show(SetupSteps.Screen.KEYS) }
            override fun undo() { show(SetupSteps.Screen.UNDO_CONFIRM) }
            // Play: the Home button watch disclosure first (DisclosureActivity); other builds: Android's settings
            override fun accessibility() { DisclosureActivity.openAccessibility(this@SetupActivity) }
        })
        settings.helpQr.setImageBitmap(SettingsScreen.helpQr())
        val first = SetupSteps.firstScreen(Store.str(SetupSteps.DONE_KEY) == "1", Auth.phoneCount(), homeIsOn())
        // a TV set up before this version: remembered, so the steps do not come back on their own
        if (first == SetupSteps.Screen.READY) Store.putStr(SetupSteps.DONE_KEY, "1")
        // a phone asked to pair (App.showPin): straight to the phone remote in Settings
        if (intent?.getBooleanExtra("pin", false) == true) { backTo = first; show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.PHONE) }
        // the home's gear menu, Phone remote: Settings on Phone remote, and Back goes back to the home
        else if (intent?.getBooleanExtra(PHONE_REMOTE, false) == true) { fromHome = true; backTo = first; show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.PHONE) }
        else show(first)
    }

    // ------------------------------------------------------------------------------------------- screens

    /** Puts a screen up. item: which Settings item is focused when it is Settings. */
    private fun show(s: SetupSteps.Screen, item: SetupSettings.Item? = null) {
        val sub = setOf(SetupSteps.Screen.SETTINGS, SetupSteps.Screen.HOME_HELP, SetupSteps.Screen.KEYS, SetupSteps.Screen.KEYS_DONE,
            SetupSteps.Screen.UNDO_CONFIRM, SetupSteps.Screen.UNDO_DONE)
        if (s in sub && screen !in sub) backTo = screen
        screen = s
        frame.removeAllViews()
        step = null; keyStatus = null
        when (s) {
            SetupSteps.Screen.HOME_STEP -> step = buildHomeStep()
            SetupSteps.Screen.OPEN_STEP -> step = screens.step(2, SetupWords.OPEN_TITLE, SetupWords.OPEN_LINE, SetupWords.OPEN_BUTTON, { openTheHome() },
                chip = SetupWords.HOME_DONE, settings = { show(SetupSteps.Screen.SETTINGS) })
            SetupSteps.Screen.READY -> step = screens.step(0, SetupWords.READY_TITLE, SetupWords.readyLine(homeOpensUs()), SetupWords.OPEN_BUTTON, { openTheHome() },
                second = SetupWords.SETTINGS, onSecond = { show(SetupSteps.Screen.SETTINGS) },
                note = SetupWords.READY_NOTE_START to SetupWords.SETTINGS)
            SetupSteps.Screen.HOME_HELP -> step = screens.help(explainReason(), SetupScreens.qrBitmap(HomeKeyRules.HELP_URL),
                onKeys = { keyIndex = firstKeyStep(); show(if (Adb.connected) SetupSteps.Screen.KEYS_DONE else SetupSteps.Screen.KEYS) },
                onBack = { show(SetupSteps.Screen.HOME_STEP) })
            SetupSteps.Screen.KEYS -> step = buildKeyStep()
            SetupSteps.Screen.KEYS_DONE -> step = buildKeysDone()
            SetupSteps.Screen.UNDO_CONFIRM -> step = screens.step(0, SetupWords.UNDO_CONFIRM_TITLE, SetupWords.UNDO_CONFIRM_LINE, SetupWords.UNDO_KEEP,
                { show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.UNDO) }, primaryKind = SetupLook.Kind.GHOST,
                second = SetupWords.UNDO_ITEM, secondKind = SetupLook.Kind.INK, onSecond = { undoCouchTv(); show(SetupSteps.Screen.UNDO_DONE) })
            SetupSteps.Screen.UNDO_DONE -> step = screens.step(0, SetupWords.UNDO_DONE_TITLE, SetupWords.UNDO_DONE_LINE, SetupWords.NOT_NOW,
                { finish() }, primaryKind = SetupLook.Kind.GHOST,
                second = SetupWords.UNDO_REMOVE, secondKind = SetupLook.Kind.INK, onSecond = { removeMe() })
            SetupSteps.Screen.SETTINGS -> {
                (settings.root.parent as? ViewGroup)?.removeView(settings.root)
                frame.addView(settings.root)
                editShown = ""; phoneShown = ""
            }
        }
        step?.let { frame.addView(it.root) }
        refresh()
        if (s == SetupSteps.Screen.SETTINGS) {
            val it = item ?: settings.selected
            settings.select(it); settings.row(it).requestFocus()
        } else step?.primary?.requestFocus()
    }

    private fun explainReason() = SetupSteps.explainReason(plan(), HomeRole.googleHome(this), Store.str(HomeAsk.BLOCKED_KEY))
    private fun keyView() = runCatching { org.json.JSONObject(HomeKey.state(this)).optString("view") }.getOrDefault("")

    private fun homeStepNow(): SetupSteps.HomeStep =
        SetupSteps.homeStep(plan(), HomeRole.googleTv(this), BuildConfig.BUILD_TYPE == "watch" || Variant.play, keyView(), askSince > 0 || awaitingRole)
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

    // ------------------------------------------------------------------------------------------- the key walk-through

    private fun keySteps() = SetupSettings.keySteps(SetupSettings.menus(HomeRole.googleTv(this), FireHome.isFireTv),
        SetupSettings.needsPairing(android.os.Build.VERSION.SDK_INT, Adb.state, FireHome.isFireTv))

    /** Skips the screens for switches this TV already has on (Settings.Global: development_settings_enabled, adb_enabled, adb_wifi_enabled). */
    private fun firstKeyStep(): Int {
        fun on(k: String) = runCatching { Settings.Global.getInt(contentResolver, k, 0) == 1 }.getOrDefault(false)
        val pairing = SetupSettings.needsPairing(android.os.Build.VERSION.SDK_INT, Adb.state, FireHome.isFireTv)
        return SetupSettings.firstKeyStep(on("development_settings_enabled"), if (pairing) on("adb_wifi_enabled") else on("adb_enabled"))
    }

    private fun buildKeyStep(): SetupScreens.Step {
        val all = keySteps()
        keyIndex = keyIndex.coerceIn(0, all.size - 1)
        val k = all[keyIndex]
        var extra: View? = null
        var side: View? = null
        if (k.action == SetupSettings.Action.CONNECT) {
            keyStatus = look.line("", 15f, SetupLook.INK_3)
            extra = keyStatus!!.apply { layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(10) } }
        }
        // Wireless debugging's code is typed on the phone (the phone page's Let the phone press keys): its QR pairs the phone too
        if (k.phoneQr) side = phoneUrl()?.let { url -> SetupWords.qrLink(url, livePin(), "/setup")?.let { SetupScreens.qrBitmap(it) } }?.let { screens.qrBox(it, 104) }
        return screens.step(keyIndex + 1, k.title, k.line, k.button, { keyAction(k.action) }, of = all.size,
            label = SetupWords.keysOf(keyIndex + 1, all.size), second = k.second, onSecond = { keyAction(k.secondAction) }, extra = extra, side = side)
    }

    private fun keyAction(a: SetupSettings.Action) {
        when (a) {
            SetupSettings.Action.OPEN_ABOUT -> if (runCatching { startActivity(Intent(Settings.ACTION_DEVICE_INFO_SETTINGS)) }.isFailure)
                runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
            SetupSettings.Action.OPEN_DEVELOPER -> if (runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)) }.isFailure)
                runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
            SetupSettings.Action.NEXT -> { keyIndex++; show(SetupSteps.Screen.KEYS) }
            SetupSettings.Action.BACK -> if (keyIndex > 0) { keyIndex--; show(SetupSteps.Screen.KEYS) } else show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.PHONE)
            SetupSettings.Action.CONNECT -> {
                if (waitStartedAt > 0) return   // one wait at a time: a second connect would only queue behind the first
                keyStatus?.text = "On the TV's \"Allow USB debugging?\", tick Always allow, then Down, Left, press Allow."
                waitStartedAt = System.currentTimeMillis(); allowSince = 0L; waitLostFocus = false; steppedAside = false; hiddenShown = false
                if (AllowWait.keepScreenOn(true)) window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                Thread { Adb.ensure(interactive = true); main.post { waitEnded(); refresh() } }.start()
            }
        }
    }

    // only the plain 5555 route asks "Allow"; a paired wireless debugging connect never shows a box
    private fun waitingForAllow() = waitStartedAt > 0 && Adb.state == "waiting_for_allow"

    /** The Connect wait is over (allowed, refused or ran out): the screen may sleep again, and the setup screen comes back if it stepped aside. */
    private fun waitEnded() {
        waitStartedAt = 0L; allowSince = 0L; hiddenShown = false
        runCatching { window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        if (AllowWait.comeBack(steppedAside, Adb.connected, inFront) && !isFinishing && !isDestroyed)
            runCatching { startActivity(Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
        steppedAside = false
    }

    /** The app's task to the back once, so a box left behind this screen can show. Nothing in the box is pressed. */
    private fun stepAside() {
        steppedAside = true   // before the move: the focus this screen loses now is not the box coming up
        android.util.Log.i("couchtv.adb", "allow wait: no box over the setup screen after ${System.currentTimeMillis() - waitStartedAt} ms, stepping aside")
        if (!moveTaskToBack(true)) android.util.Log.w("couchtv.adb", "allow wait: could not move the task back")
    }

    private fun buildKeysDone(): SetupScreens.Step {
        val offer = SetupSettings.offerHomeKey(keyView(), HomeKeyRules.needed(HomeRole.googleHome(this), FireHome.isFireTv))
        // with the Home button offer, the heading says the keys work: no second line, so the card fits a TV screen
        return if (offer) screens.step(0, SetupWords.KEYS_DONE_TITLE, "", HomeKeyRules.BUTTON,
            { HomeKey.start(this); show(SetupSteps.Screen.HOME_STEP) }, chip = SetupWords.DONE, after = SetupWords.KEYS_DONE_HOME,
            second = SetupWords.NOT_NOW, onSecond = { show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.PHONE) })
        else screens.step(0, SetupWords.KEYS_DONE_TITLE, SetupWords.KEYS_DONE_LINE, SetupWords.DONE,
            { show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.PHONE) }, chip = SetupWords.DONE)
    }

    // ------------------------------------------------------------------------------------------- Undo Couch TV

    /**
     * Back to the TV's own home, with no computer: the home alias off (Android's Home goes back to the TV's own
     * home), and the Home button version's watch off (it switches itself off, or the app takes it out of Android's
     * list with the secure settings grant). The on-TV app changes nothing else outside itself.
     */
    private fun undoCouchTv() {
        askSince = 0L; awaitingRole = false; main.removeCallbacks(ask); main.removeCallbacks(bringBack)
        Store.putStr(HomeAsk.PENDING_KEY, null)
        App.setHomeEnabled(this, false); FireHome.poke()
        val canWrite = checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == android.content.pm.PackageManager.PERMISSION_GRANTED
        when (SetupSettings.undoWatch(Variant.hasWatch, WatchService.connected, canWrite)) {
            "self" -> if (!WatchService.switchOff() && canWrite) watchOutOfList()
            "settings" -> watchOutOfList()
        }
        // set up again from step 1 next time
        Store.putStr(SetupSteps.DONE_KEY, null)
        android.util.Log.i("couchtv.setup", "undo couch tv: home off, watch off")
    }
    private fun watchOutOfList() = runCatching {
        val cur = Settings.Secure.getString(contentResolver, "enabled_accessibility_services")
        Settings.Secure.putString(contentResolver, "enabled_accessibility_services", HomeKeyRules.withoutWatch(cur, packageName))
    }

    /** Android's own "Uninstall?" for this app (REQUEST_DELETE_PACKAGES); else its App info page, which has Uninstall. */
    private fun removeMe() {
        val pkg = Uri.parse("package:$packageName")
        if (runCatching { startActivity(Intent(Intent.ACTION_DELETE, pkg)) }.isFailure)
            runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)) }
    }

    @Deprecated("Back on a TV remote")
    override fun onBackPressed() {
        when (screen) {
            SetupSteps.Screen.SETTINGS -> {
                val back = SetupSteps.settingsBack(fromHome, isTaskRoot)
                fromHome = false
                when (back) {
                    SetupSteps.SettingsBack.BACK_TO -> show(backTo)
                    SetupSteps.SettingsBack.FINISH -> finish()
                    // the home was cleared from above this screen: open it again, and keep this screen under it
                    SetupSteps.SettingsBack.REOPEN_HOME -> {
                        show(backTo)
                        if (runCatching { startActivity(Intent(this, HomeActivity::class.java)) }.isFailure) finish()
                    }
                }
            }
            SetupSteps.Screen.HOME_HELP -> show(SetupSteps.Screen.HOME_STEP)
            SetupSteps.Screen.KEYS -> if (AllowWait.backStepsAside(hiddenShown, waitingForAllow())) stepAside() else keyAction(SetupSettings.Action.BACK)
            SetupSteps.Screen.KEYS_DONE -> show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.PHONE)
            SetupSteps.Screen.UNDO_CONFIRM -> show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.UNDO)
            SetupSteps.Screen.OPEN_STEP -> if (Store.str(SetupSteps.DONE_KEY) == "1") show(SetupSteps.Screen.READY) else show(SetupSteps.Screen.HOME_STEP)
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    /**
     * Step 1's Make it my home: switches the home on and asks Android where it can. A TV that cannot be asked from
     * here (Google's Android TV Home without "draw over apps", or a TV that had no question before): change nothing
     * and stay here, step 1 says what to do (TCL, 23 Nov 2026: switching the home on put Google's home in front and
     * this screen never came back).
     */
    private fun turnHomeOn() {
        if (askSince > 0) return
        declined = false
        val plan = plan()
        android.util.Log.i("couchtv.homeask", "use as home screen pressed: $plan")
        if (plan == HomeAsk.Plan.EXPLAIN) { if (App.homeEnabled(this)) App.setHomeEnabled(this, false); refresh(); return }
        App.setHomeEnabled(this, true); FireHome.poke()
        // No computer: Android's own "default home app" request (plain Android TV 10+), else its Home settings.
        // Not at once: Android needs a moment to take in the alias just switched on (HomeAsk.kt).
        if (plan == HomeAsk.Plan.ASK && !HomeRole.held(this)) {
            askSince = System.currentTimeMillis(); broughtBack = false; pausedAt = 0L
            // kept, so a setup screen Android closes while it is behind another home is noticed when Couch TV opens again
            Store.putStr(HomeAsk.PENDING_KEY, askSince.toString())
            main.post(ask)
        }
        refresh()
    }

    // ------------------------------------------------------------------------------------------- Android

    override fun onResume() {
        super.onResume(); inFront = true
        Auth.onPin(pinListener); main.post(tick)
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
        // something came over this screen during the Allow wait: the box showed, so the person is reading it
        if (!has && waitStartedAt > 0 && inFront && !steppedAside) waitLostFocus = true
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
        }
        refresh()
    }
    override fun onNewIntent(i: Intent) {
        super.onNewIntent(i)
        if (backFromUpdate(i)) return
        if (i.getBooleanExtra("pin", false)) show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.PHONE)
        else if (i.getBooleanExtra(PHONE_REMOTE, false)) { fromHome = true; show(SetupSteps.Screen.SETTINGS, SetupSettings.Item.PHONE) }
        else refresh()
    }

    /** Opens the home when the intent comes from the update's shell line, once (the extra goes). */
    private fun backFromUpdate(i: Intent?): Boolean {
        if (i?.getBooleanExtra("updated", false) != true) return false
        i.removeExtra("updated")
        startActivity(Intent(this, HomeActivity::class.java))
        return true
    }

    private fun homeIsOn(): Boolean = HomeAsk.isOn(App.homeEnabled(this), HomeRole.held(this), homeOpensUs(), HomeRole.googleTv(this))

    /** True when the TV's Home button already opens this app (the HomeAlias). */
    private fun homeOpensUs(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val pkg = runCatching { packageManager.resolveActivity(home, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName }.getOrNull()
        return pkg == packageName
    }

    private fun phoneUrl(): String? = App.lanAddress()?.let { "http://$it:${Store.port}" }
    /** A live code while the phone's QR is on screen (renewed before it runs out), none while pairing is locked. */
    private fun livePin(): String? = if (Auth.lockedEverywhere() > 0) null else Auth.pinForQr()

    private fun refresh() {
        if (!::frame.isInitialized) return
        when (screen) {
            SetupSteps.Screen.SETTINGS -> refreshSettings()
            else -> refreshStep()
        }
    }

    /** The step screen's words and buttons, from what Android, the key link and HomeKey report now. */
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
            SetupSteps.Screen.KEYS -> {
                // the link came up: the walk-through is done
                if (Adb.connected) { show(SetupSteps.Screen.KEYS_DONE); return }
                val st = Adb.status()
                if (keyStatus != null && waitStartedAt > 0) {
                    // counted from when Adb started waiting for Allow (a paired TV first tries wireless debugging)
                    val now = System.currentTimeMillis()
                    if (waitingForAllow()) { if (allowSince == 0L) allowSince = now } else allowSince = 0L
                    val h = AllowWait.hint(if (allowSince > 0) now - allowSince else 0L, waitingForAllow(), hasWindowFocus(), waitLostFocus, inFront, steppedAside)
                    if (h.sayHidden) { hiddenShown = true; keyStatus?.text = SetupWords.ALLOW_HIDDEN }
                    if (h.stepAside) stepAside()
                    if (h.sayHidden) return
                }
                if (keyStatus != null && (st["state"] != "off" || Adb.unanswered))
                    keyStatus?.text = SetupWords.keysLine(false, st["state"] == "waiting_for_allow" || st["state"] == "connecting", st["state"] == "needs_pairing", Adb.unanswered)
                        .let { if (it.startsWith("The phone remote opens apps")) "" else it }
            }
            else -> {}
        }
    }

    private fun refreshSettings() {
        val url = phoneUrl()
        val locked = Auth.lockedEverywhere()
        val pin = if (settings.selected == SetupSettings.Item.EDIT || settings.selected == SetupSettings.Item.PHONE) livePin() else Auth.currentPin()
        // one scan pairs: while a code is live it rides in the QR's #fragment (never sent to the TV in a request
        // line, so never in a log); the phone page pairs with it at once (shim.js)
        val editLink = SetupWords.qrLink(url, pin, "/setup")
        if (editLink != editShown) { editShown = editLink; settings.editQr.setImageBitmap(editLink?.let { SetupScreens.qrBitmap(it) }) }
        settings.editType.text = SetupWords.editType(url?.let { "$it/setup" }, pin)
        val phoneLink = SetupWords.qrLink(url, pin)
        if (phoneLink != phoneShown) { phoneShown = phoneLink; settings.phoneQr.setImageBitmap(phoneLink?.let { SetupScreens.qrBitmap(it) }) }
        settings.phoneCode.text = SetupWords.phoneCode(pin, locked)
        settings.phoneType.text = SetupWords.phoneType(url)
        settings.setPhones(Auth.phoneCount())
        val fireBlocked = FireHome.isFireTv && (Adb.lastError ?: "").contains(Adb.FIRE_BLOCKED)
        settings.setStrip(SetupSettings.keyStrip(Adb.connected, fireBlocked))
        settings.setWatchLine(SetupSettings.showWatchLine(Variant.hasWatch,
            HomeKeyRules.watching(WatchService.connected, FireHome.isFireTv, android.os.Build.VERSION.SDK_INT, FireHome.usageAllowed)))
    }
}
