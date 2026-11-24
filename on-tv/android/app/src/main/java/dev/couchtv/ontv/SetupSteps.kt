package dev.couchtv.ontv

/**
 * Which screen the Couch TV tile opens on, and what step 1 offers on this TV, as plain decisions so
 * SetupStepsTest checks them on a computer.
 *
 * The owner's from scratch TCL test of 0.13.9 (Android TV 11, installed from Downloader, 23 Nov 2026):
 * the old setup screen put two QR codes, four buttons and two paragraphs on one screen. Now a new TV gets
 * two steps with one heading, one line and one or two big buttons each, done with the TV remote alone:
 *  Step 1 of 2  Make Couch TV your home (HomeAsk.plan: ask where Android can ask, else say so in one line)
 *  Step 2 of 2  Open your new home (the home's own first-run welcome then offers a design code or Couch Original)
 * Every later open shows "Couch TV is ready" with Open the home and Settings. The phone remote, the key
 * link, the computer route and every note moved to Settings; nothing was taken away.
 */
object SetupSteps {
    enum class Screen { HOME_STEP, OPEN_STEP, READY, SETTINGS, HOME_HELP, KEYS, KEYS_DONE, UNDO_CONFIRM, UNDO_DONE }

    /** Store key: "1" once Open the home was pressed on step 2 (or the TV was set up before this version). */
    const val DONE_KEY = "setup_done"

    /**
     * Where the tile opens. A TV set up before (the flag, a paired phone, or Couch TV already the home, so an
     * update from 0.13.9 never walks anyone through the steps again) goes to READY; a new TV to step 1.
     */
    fun firstScreen(done: Boolean, phones: Int, homeOn: Boolean): Screen =
        if (done || phones > 0 || homeOn) Screen.READY else Screen.HOME_STEP

    /** What Back does on Settings. */
    enum class SettingsBack {
        /** the setup screen it came from (READY or step 1) */
        BACK_TO,
        /** close the setup screen: the home is still under it */
        FINISH,
        /** show where it came from and open the home again above it */
        REOPEN_HOME
    }

    /**
     * Back on Settings. Opened from the home's gear, Phone remote (fromHome): when the home was opened from the
     * setup screen (Couch TV in the apps row, Open the home), the setup screen is the task's root, and opening it
     * again (singleTask) cleared the home above it, so a bare finish() left an empty task and Google's home showed
     * (0.13.12 RC emulator pass, 24 Nov 2026). Then the home opens again above the setup screen, as it was before
     * the gear. When the home is under the setup screen (Couch TV is the Home app), finish() goes back to it.
     */
    fun settingsBack(fromHome: Boolean, taskRoot: Boolean): SettingsBack = when {
        !fromHome -> SettingsBack.BACK_TO
        taskRoot -> SettingsBack.REOPEN_HOME
        else -> SettingsBack.FINISH
    }

    /** What step 1 offers. */
    enum class HomeStep {
        /** one press asks Android's own "default home app" question (HomeAsk.Plan.ASK) */
        ASK,
        /** one press switches the home on without a question (Google TV with the watch version, HomeAsk.Plan.SWITCH_ONLY) */
        SWITCH,
        /** Android's question is on its way or on screen */
        ASKING,
        /** this TV keeps Google's home on the Home button, but one press can change that (Make Home open Couch TV, HomeKey) */
        KEY,
        /** Make Home open Couch TV is downloading or installing */
        BUSY,
        /** nothing to press on this TV: one line says so, Next goes on, More help has the ways round it */
        EXPLAIN,
    }

    /**
     * plan: HomeAsk.plan for this TV. googleTv, watchApk: as HomeAsk. keyView: HomeKeyRules.view ("ready", "busy", ...).
     * On Google TV with the phone only download the home switch changes nothing the person can see (Google TV keeps
     * the Home button), so the setup screen never offered it there: step 1 explains instead.
     */
    fun homeStep(plan: HomeAsk.Plan, googleTv: Boolean, watchApk: Boolean, keyView: String, asking: Boolean): HomeStep {
        val cannotAsk = plan == HomeAsk.Plan.EXPLAIN || (googleTv && !watchApk)
        return when {
            asking -> HomeStep.ASKING
            keyView == "busy" -> HomeStep.BUSY
            cannotAsk && keyView == "ready" -> HomeStep.KEY
            cannotAsk -> HomeStep.EXPLAIN
            plan == HomeAsk.Plan.SWITCH_ONLY -> HomeStep.SWITCH
            else -> HomeStep.ASK
        }
    }

    /** Why step 1 explains (for SetupWords.homeStepLine and the More help screen): HomeAsk.noAskReason, or "google" on Google TV. */
    fun explainReason(plan: HomeAsk.Plan, googleHome: Boolean, blocked: String?): String =
        HomeAsk.noAskReason(plan, googleHome, blocked) ?: "google"

    /** Step 1 is done and step 2 shows: Couch TV is the home now (HomeAsk.isOn, from what Android reports). */
    fun stepOneDone(homeOn: Boolean): Boolean = homeOn
}
