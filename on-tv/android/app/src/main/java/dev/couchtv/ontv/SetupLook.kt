package dev.couchtv.ontv

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The look of the setup screens: the couch-tv Studio website's own (tools/tv-designer/site/public/css/site.css),
 * powder blue wall, rounded paper cards, Nunito Black headings, Inter text, ink and ghost pill buttons, the
 * couch-tv mark beside "Couch TV". The fonts are static cuts of the site's own (setup-assets/fonts), so nothing
 * comes from the network. Sizes are in dp for a 960 x 540 dp screen (a 1080p or 720p TV), and the remote's focus
 * is a sun yellow ring with a paper gap, the button a little bigger.
 *
 * Plain views built in code, like the rest of the app, so SetupShotsTest can draw them on a computer.
 */
class SetupLook(val c: Context) {
    private val dp = c.resources.displayMetrics.density
    fun px(v: Float) = (v * dp).toInt()
    fun px(v: Int) = px(v.toFloat())

    val displayFace: Typeface = font("nunito_black.ttf", Typeface.DEFAULT_BOLD)
    val textFace: Typeface = font("inter_regular.ttf", Typeface.DEFAULT)
    val semiFace: Typeface = font("inter_semibold.ttf", Typeface.DEFAULT_BOLD)
    private fun font(name: String, fallback: Typeface): Typeface =
        runCatching { Typeface.createFromAsset(c.assets, "fonts/$name") }.getOrDefault(fallback)

    private fun TextView.sizeDp(v: Float) = setTextSize(TypedValue.COMPLEX_UNIT_DIP, v)

    fun heading(t: String, size: Float = 42f) = TextView(c).apply {
        text = t; typeface = displayFace; sizeDp(size); setTextColor(INK)
        letterSpacing = -0.035f; setLineSpacing(0f, 0.92f)
    }

    fun line(t: CharSequence, size: Float = 19f, colour: Int = INK_2) = TextView(c).apply {
        text = t; typeface = textFace; sizeDp(size); setTextColor(colour); setLineSpacing(0f, 1.18f)
    }

    /** "Step 1 of 2" with the two bars: done steps leaf green, this one ink, the rest pale. */
    fun eyebrow(step: Int, of: Int = 2, text: String = SetupWords.stepOf(step, of)) = LinearLayout(c).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        for (i in 1..of) addView(View(c).apply {
            background = round(when { i < step -> LEAF; i == step -> INK; else -> PALE }, 3f)
            layoutParams = LinearLayout.LayoutParams(px(26), px(6)).apply { rightMargin = px(6) }
        })
        addView(label(text), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = px(4) })
    }

    fun label(t: String) = TextView(c).apply { text = t; typeface = semiFace; sizeDp(14f); setTextColor(INK_3) }

    /** The couch-tv mark and "Couch TV", top left of every screen. */
    fun brand() = LinearLayout(c).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        addView(ImageView(c).apply {
            setImageResource(R.drawable.logo_mark); adjustViewBounds = true
            layoutParams = LinearLayout.LayoutParams(px(37), px(30)).apply { rightMargin = px(12) }
        })
        addView(TextView(c).apply { text = "Couch TV"; typeface = displayFace; sizeDp(22f); setTextColor(INK); letterSpacing = -0.02f })
    }

    enum class Kind { INK, GHOST, LINK }

    /**
     * A pill button for the remote: focusable, OK presses it. On focus it gains the sun ring and grows a
     * little; the ring's room is kept around it always, so nothing moves when focus comes or goes.
     * surface: the colour behind it (the ring's gap).
     */
    fun pill(t: String, kind: Kind = Kind.INK, small: Boolean = false, surface: Int = PAPER, on: () -> Unit = {}) = TextView(c).apply {
        text = t; typeface = semiFace; sizeDp(if (small) 15f else 18f); gravity = Gravity.CENTER; maxLines = 1
        setTextColor(if (kind == Kind.INK) Color.WHITE else if (kind == Kind.LINK) INK_2 else INK)
        if (kind == Kind.LINK) paintFlags = paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
        val ring = px(4); val gap = px(4)
        val fill = if (kind == Kind.INK) INK else if (kind == Kind.GHOST) Color.WHITE else Color.TRANSPARENT
        val outer = GradientDrawable().apply { cornerRadius = px(999).toFloat() }
        val mid = GradientDrawable().apply { cornerRadius = px(999).toFloat() }
        val inner = GradientDrawable().apply {
            cornerRadius = px(999).toFloat(); setColor(fill)
            if (kind == Kind.GHOST) setStroke(px(1.5f), HAIR)
        }
        val layers = LayerDrawable(arrayOf(outer, mid, inner)).apply {
            setLayerInset(1, ring, ring, ring, ring); setLayerInset(2, ring + gap, ring + gap, ring + gap, ring + gap)
        }
        background = layers
        fun paint(has: Boolean) {
            outer.setColor(if (has) SUN else Color.TRANSPARENT); mid.setColor(if (has) surface else Color.TRANSPARENT)
            if (kind == Kind.LINK) setTextColor(if (has) INK else INK_2)
        }
        paint(false)
        val h = if (small) 40 else 56
        val padX = if (kind == Kind.LINK) 14 else if (small) 18 else 30
        setPadding(px(padX) + ring + gap, 0, px(padX) + ring + gap, 0)
        minHeight = px(h) + 2 * (ring + gap); minimumHeight = minHeight
        isFocusable = true; isClickable = true
        setOnClickListener { on() }
        setOnFocusChangeListener { v, has ->
            paint(has)
            v.animate().scaleX(if (has) 1.06f else 1f).scaleY(if (has) 1.06f else 1f).setDuration(140).start()
        }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    /** The rounded paper card in the middle of a screen. */
    fun card(width: Int = 640, padH: Int = 52, padV: Int = 44) = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL
        background = round(PAPER, 36f); clipChildren = false; clipToPadding = false
        elevation = px(14).toFloat()
        setPadding(px(padH), px(padV), px(padH), px(padV + 2))
        layoutParams = FrameLayout.LayoutParams(px(width), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
    }

    /** The row of big buttons under a card's words (the pills bring their own focus room, so a small gap). */
    fun actions(vararg pills: View) = LinearLayout(c).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        // the pills' ring room (8 dp) sits outside the fill, so pull the row left by it to line up with the words
        clipChildren = false; clipToPadding = false
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = -px(8); topMargin = px(20) }
        pills.forEachIndexed { i, p -> if (i > 0) (p.layoutParams as LinearLayout.LayoutParams).leftMargin = px(6); addView(p) }
    }

    /** The green "done" note (step 2), with a drawn tick. */
    fun doneChip(t: String) = TextView(c).apply {
        text = t; typeface = semiFace; sizeDp(15f); setTextColor(LEAF)
        background = round(Color.argb(26, 17, 128, 75), 999f)
        setCompoundDrawablesWithIntrinsicBounds(R.drawable.setup_tick, 0, 0, 0); compoundDrawablePadding = px(8)
        setPadding(px(10), px(7), px(14), px(7))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(18) }
    }

    /** "Want a phone remote? It's in Settings." with Settings in ink. */
    fun note(start: String, bold: String) = line(SpannableStringBuilder(start).apply {
        val at = length; append(bold)
        setSpan(StyleSpan(Typeface.BOLD), at, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        setSpan(ForegroundColorSpan(INK), at, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        append(".")
    }, 15f, INK_3).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(18) }
    }

    /** A whole screen: the wall, the mark top left, an optional small button top right, the card centred. */
    fun screen(card: View, corner: View? = null) = FrameLayout(c).apply {
        setBackgroundColor(WALL); clipChildren = false
        addView(brand(), FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            leftMargin = px(48); topMargin = px(32)
        })
        if (corner != null) addView(corner, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            rightMargin = px(40); topMargin = px(18)
        })
        addView(FrameLayout(c).apply {
            clipChildren = false; clipToPadding = false
            setPadding(px(24), px(72), px(24), px(24))
            addView(card)
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    fun round(colour: Int, radiusDp: Float) = GradientDrawable().apply { setColor(colour); cornerRadius = px(radiusDp).toFloat() }

    /** A gap of this many dp in a vertical card. */
    fun space(h: Int) = View(c).apply { layoutParams = LinearLayout.LayoutParams(1, px(h)) }

    companion object {
        val WALL = Color.parseColor("#BDCFE1")
        val PAPER = Color.parseColor("#FBFAF7")
        val INK = Color.parseColor("#14131A")
        val INK_2 = Color.parseColor("#44424C")
        val INK_3 = Color.parseColor("#5F5D67")
        val SUN = Color.parseColor("#FFC81E")
        val LEAF = Color.parseColor("#11804B")
        val PALE = Color.argb(36, 20, 19, 26)
        val HAIR = Color.argb(31, 20, 19, 26)
    }
}
