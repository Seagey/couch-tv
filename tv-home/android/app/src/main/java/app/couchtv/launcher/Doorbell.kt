package app.couchtv.launcher

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Outline
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The doorbell card (optional, smart home through Home Assistant; first made in the roliusz fork).
 * Only when config.json has a "doorbell" in its "home_assistant" section. Then, while the screen
 * is on, the launcher looks at the doorbell entity every few seconds. When someone rings, a card
 * with the door camera's still picture (a new one every two seconds) slides in at the top right
 * over whatever is playing. Any button on the remote hides it for that ring; otherwise it goes by
 * itself after 45 seconds. With the screen off nothing is asked at all.
 *
 * What counts as a ring:
 *   binary_sensor.* or input_boolean.*  it turns on (the next ring is the next time it turns on)
 *   event.*                             a new event, the way doorbells such as Ring and Reolink
 *                                       report presses (its state is the time of the last one)
 *
 * Over other apps it needs "display over other apps", which apply.sh grants over ADB only when a
 * doorbell is set up (undo.sh takes it back). Without that grant there is no card, and nothing else
 * changes. Home Assistant not answering: no card, and it keeps quietly asking.
 */
object Doorbell {
    private const val CHECK_MS = 3_000L
    private const val PICTURE_MS = 2_000L
    private const val RING_MS = 45_000L
    private const val FRESH_MS = 60_000L   // an event older than this, seen when the screen comes on, is not a ring

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var app: Context? = null
    private var watching = false    // the screen on/off receiver is registered
    private var looping = false
    private var asking = false
    private var wasOn: Boolean? = null
    private var lastEvent: String? = null
    private var card: View? = null
    private var picture: ImageView? = null

    /** Called when the launcher starts and whenever apply.sh sends new settings. Safe to repeat. */
    fun start(ctx: Context) {
        app = ctx.applicationContext
        main.post {
            val c = app ?: return@post
            if (HomeAssistant.settings(c)?.doorbell == null) { stop(c); return@post }
            if (!watching) {
                val f = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) }
                // screen on and off are system broadcasts: no other app can send them
                if (Build.VERSION.SDK_INT >= 33) c.registerReceiver(screen, f, Context.RECEIVER_EXPORTED)
                else c.registerReceiver(screen, f)
                watching = true
            }
            loop()
        }
    }

    private fun stop(c: Context) {
        main.removeCallbacks(check)
        looping = false
        if (watching) { try { c.unregisterReceiver(screen) } catch (e: Exception) {}; watching = false }
        wasOn = null; lastEvent = null
        hide()
    }

    private val screen = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (i.action == Intent.ACTION_SCREEN_ON) loop() else { main.removeCallbacks(check); looping = false; hide() }
        }
    }

    private fun loop() {
        if (looping) return
        looping = true
        main.post(check)
    }

    private fun awake(c: Context) = (c.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive

    private val check = object : Runnable {
        override fun run() {
            val c = app ?: return
            val s = HomeAssistant.settings(c)
            val bell = s?.doorbell
            if (s == null || bell == null) { stop(c); return }
            if (!awake(c)) { looping = false; hide(); return }   // the screen coming on starts it again
            main.postDelayed(this, CHECK_MS)
            if (asking) return   // the last question is still out: Home Assistant is slow
            asking = true
            io.execute {
                val st = HomeAssistant.state(s, bell.entity)?.optString("state")
                main.post { asking = false; if (st != null) seen(c, bell, st) }
            }
        }
    }

    private fun seen(c: Context, bell: HomeAssistant.Bell, state: String) {
        if (state == "unavailable" || state == "unknown") return
        if (bell.entity.startsWith("event.")) {
            val first = lastEvent == null
            if (state == lastEvent) return
            lastEvent = state
            // the first look only learns the last press, unless that press was just now
            val at = try { java.time.OffsetDateTime.parse(state).toInstant().toEpochMilli() } catch (e: Exception) { null }
            if (first && (at == null || System.currentTimeMillis() - at > FRESH_MS)) return
            ring(c, bell)
        } else {
            val on = state == "on"
            val before = wasOn ?: false
            wasOn = on
            if (on && !before) ring(c, bell)
        }
    }

    private fun ring(c: Context, bell: HomeAssistant.Bell) {
        main.removeCallbacks(timeUp)
        main.postDelayed(timeUp, RING_MS)
        if (card == null) show(c, bell)
    }

    private val timeUp = Runnable { hide() }

    private val refresh = object : Runnable {
        override fun run() {
            val c = app ?: return
            val img = picture ?: return
            val s = HomeAssistant.settings(c) ?: return
            val width = img.width.coerceAtLeast(320)
            io.execute {
                val bmp = HomeAssistant.snapshot(s, width)
                main.post { if (bmp != null && picture === img) img.setImageBitmap(bmp) }
            }
            main.postDelayed(this, PICTURE_MS)
        }
    }

    // ---------------------------------------------------------------- the card

    private fun show(c: Context, bell: HomeAssistant.Bell) {
        if (!Settings.canDrawOverlays(c)) return   // not granted (apply.sh grants it with a doorbell)
        val wm = c.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val m = c.resources.displayMetrics
        val dp = m.density
        val w = (maxOf(m.widthPixels, m.heightPixels) * 0.25f).toInt()   // 480 of 1920
        val camH = if (bell.camera != null) w * 9 / 16 else 0
        val words = words(c)

        val frame = LinearLayout(c).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply { setColor(Color.parseColor("#EE131614")); cornerRadius = 18 * dp }
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(v: View, o: Outline) { o.setRoundRect(0, 0, v.width, v.height, 18 * dp) }
            }
            clipToOutline = true
            elevation = 12 * dp
        }
        var img: ImageView? = null
        if (bell.camera != null) {
            img = ImageView(c).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setBackgroundColor(Color.BLACK) }
            frame.addView(img, LinearLayout.LayoutParams(w, camH))
        }
        val text = LinearLayout(c).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((18 * dp).toInt(), (12 * dp).toInt(), (18 * dp).toInt(), (14 * dp).toInt())
        }
        text.addView(TextView(c).apply {
            this.text = bell.name.ifEmpty { words.first }
            setTextColor(CREAM); textSize = 17f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        })
        text.addView(TextView(c).apply {
            this.text = words.second
            setTextColor(CREAM_2); textSize = 13f
        })
        frame.addView(text, LinearLayout.LayoutParams(w, FrameLayout.LayoutParams.WRAP_CONTENT))

        // It takes the remote while it is up, so the first press hides it (and only hides it).
        frame.isFocusable = true
        frame.isFocusableInTouchMode = true
        frame.setOnKeyListener { _, _, e ->
            if (e.action == KeyEvent.ACTION_UP) hide()
            true
        }
        val lp = WindowManager.LayoutParams(w, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.END
            x = (m.widthPixels * 0.042f).toInt()    // inside the TV's safe area (80 of 1920)
            y = (m.heightPixels * 0.056f).toInt()   // (60 of 1080)
        }
        try { wm.addView(frame, lp) } catch (e: Exception) { return }
        frame.requestFocus()
        card = frame; picture = img
        frame.alpha = 0f; frame.translationY = -20 * dp
        frame.animate().alpha(1f).translationY(0f).setDuration(380)
            .setInterpolator(android.view.animation.PathInterpolator(0.2f, 0.8f, 0.2f, 1f)).start()
        main.removeCallbacks(refresh)
        if (img != null) main.post(refresh)
    }

    private fun hide() {
        main.removeCallbacks(timeUp)
        main.removeCallbacks(refresh)
        val v = card ?: return
        card = null; picture = null
        val c = app ?: return
        v.animate().alpha(0f).translationY(-14 * c.resources.displayMetrics.density).setDuration(260).withEndAction {
            try { (c.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(v) } catch (e: Exception) {}
        }.start()
    }

    /**
     * The card's words, in the language picked in Home settings (else home.language, else the TV's
     * own language, as the home page does; English for any other).
     */
    private fun words(c: Context): Pair<String, String> {
        val lang = try {
            c.getSharedPreferences("page", Context.MODE_PRIVATE).getString("tvhome.settings", null)
                ?.let { JSONObject(it).optJSONObject("s")?.optString("lang") }?.takeIf { it.isNotEmpty() }
                ?: c.getSharedPreferences("home", Context.MODE_PRIVATE).getString("config", null)
                    ?.let { JSONObject(it).optJSONObject("home")?.optString("language") }?.takeIf { it.isNotEmpty() }
        } catch (e: Exception) { null } ?: java.util.Locale.getDefault().language
        return when {
            lang.startsWith("es") -> "Timbre" to "Hay alguien en la puerta"
            lang.startsWith("it") -> "Campanello" to "C'è qualcuno alla porta"
            else -> "Doorbell" to "Someone is at the door"
        }
    }

    private val CREAM = Color.parseColor("#F2EAD8")
    private val CREAM_2 = Color.parseColor("#BDB6A7")
}
