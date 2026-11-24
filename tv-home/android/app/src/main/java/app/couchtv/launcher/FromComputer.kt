package app.couchtv.launcher

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * Who may change this TV's settings and its account link from outside (security gate, 25 Nov 2026). MainActivity is
 * a home screen, so any app on the TV can start it: its extras say nothing about who sent them. Two doors instead,
 * both behind android.permission.DUMP, which Android gives ADB's shell (the computer the TV allowed) and no TV app,
 * on every Android this app runs on and on Fire OS:
 *  - [FromComputer]: `am start -n app.couchtv.launcher/.FromComputer --es bridge ... --es config_b64 ...`
 *  - [SetupLink]: `am broadcast -n app.couchtv.launcher/.SetupLink --es account_link ...`, which answers.
 * Older Setup and apply.sh still start MainActivity itself: [StartRules] says what happens then.
 */
class FromComputer : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val go = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // only the known extras, kept in this process: what MainActivity gets is a one time number, so Android
        // starting it again later with the same intent carries nothing
        intent?.let { i -> go.putExtra(EXTRA, Handed.put(StartRules.only(i))) }
        startActivity(go)
        finish()
    }

    companion object { const val EXTRA = "app.couchtv.launcher.FROM_COMPUTER" }
}

/** Setup's account link. Answers "couchtv-link ok <first 16 of the link's sha256>" only once it is really kept. */
class SetupLink : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val kept = AccountLink.readExtras(ctx, i)
        val held = AccountLink.token(AccountLink.kv(ctx))
        val sent = AccountLink.cleanLink(i.getStringExtra("account_link")?.trim())
        if (kept) MainActivity.setupDesign()
        if (!isOrderedBroadcast) return
        if (sent != null && held == sent) setResult(1, "couchtv-link ok " + AccountLink.proof(sent), null)
        else setResult(2, "couchtv-link no", null)
    }
}

/** What [FromComputer] hands to MainActivity, once each, gone with the process. */
object Handed {
    private val waiting = HashMap<String, Intent>()
    @Synchronized fun put(i: Intent): String = java.util.UUID.randomUUID().toString().also { if (waiting.size > 8) waiting.clear(); waiting[it] = i }
    @Synchronized fun take(id: String?): Intent? = id?.let { waiting.remove(it) }
}

/** What to do with a start that carries settings or a link. Plain rules, so they are tested without a TV. */
object StartRules {
    val SETTINGS = listOf("bridge", "config_b64", "tv", "key", "ha_b64")
    val LINK = listOf("account_link", "design_code")

    enum class Do { TAKE, ASK, DROP }

    /** Who started it: the computer over ADB, another app, or (Android 10 and older) nobody can say. */
    enum class Who { COMPUTER, APP, UNKNOWN }

    fun has(i: Intent?): Boolean = i != null && (SETTINGS + LINK).any { i.hasExtra(it) }
    fun hasSettings(i: Intent): Boolean = i.hasExtra("bridge") || i.hasExtra("config_b64")
    fun hasLink(i: Intent): Boolean = LINK.any { i.hasExtra(it) }
    fun only(i: Intent): Intent = Intent().also { o -> for (k in SETTINGS + LINK) i.getStringExtra(k)?.let { v -> o.putExtra(k, v) } }

    /** Android 11 and newer check the caller's package name before they report it; older ones take its word. */
    fun who(sdk: Int, startedBy: String?): Who = when {
        sdk < 30 || startedBy == null -> Who.UNKNOWN
        startedBy == "com.android.shell" -> Who.COMPUTER
        else -> Who.APP
    }

    /**
     * Is this TV in use? Settings from a computer, an account link, or Couch TV put on by hand more than an hour ago
     * (then there are no settings to see, but there is a home somebody uses).
     */
    fun setUp(settings: Boolean, linked: Boolean, installedFor: Long): Boolean = settings || linked || installedFor !in 0..3_600_000L

    /**
     * replay: Android started this again by itself with an intent already dealt with. setUp: this TV has settings.
     * The first set up of a new TV asks nothing, whoever sends it; an account link is never taken from an unknown caller
     * without the person at the TV (new Setup sends it through [SetupLink]).
     */
    fun decide(who: Who, replay: Boolean, link: Boolean, setUp: Boolean): Do = when {
        replay || who == Who.APP -> Do.DROP
        who == Who.COMPUTER -> Do.TAKE
        link || setUp -> Do.ASK
        else -> Do.TAKE
    }

    /**
     * One start, told apart from the same one delivered again after the process died (the system keeps a task's
     * first intent): the same extras, in the same task, in the same boot. A new `am start` with the same words is a new
     * task (Setup and apply.sh stop the app first) or arrives in onNewIntent, which the system never repeats.
     */
    fun startId(extras: Map<String, String?>, task: Int, boot: Int): String =
        AccountLink.sha(extras.toSortedMap().entries.joinToString("\n") { it.key + "=" + it.value } + "\n$task\n$boot")

    /** True when this start was dealt with before; remembers it (the last 12). */
    fun seen(kv: AccountLink.Kv, id: String): Boolean {
        val had = (kv.get("starts") ?: "").split(",").filter { it.isNotEmpty() }
        if (id in had) return true
        kv.put("starts", (had + id).takeLast(12).joinToString(","))
        return false
    }
}
