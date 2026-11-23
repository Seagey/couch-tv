package dev.couchtv.ontv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import dev.couchtv.ontv.SetupSettings.Item
import dev.couchtv.ontv.SetupSettings.Strip

/**
 * Settings on the TV, the layout the owner picked (round 2, 23 Nov 2026): the list on the left (Edit your
 * home, Phone remote, Undo Couch TV, and a small Help at the bottom), the focused item's panel on the
 * right. Built from SetupLook with no Android state in it: SetupActivity fills it in (fill...) and
 * SetupShotsTest draws it on a computer.
 */
class SettingsScreen(private val look: SetupLook, private val on: Actions) {
    interface Actions {
        fun newCode(); fun forgetPhones(); fun keys(); fun undo(); fun accessibility()
    }

    private val c = look.c
    val root: FrameLayout
    var selected = Item.EDIT; private set
    private val rows = HashMap<Item, View>()
    private val subs = HashMap<Item, TextView>()
    private val panels = HashMap<Item, View>()

    // the parts the activity fills in
    val editQr = ImageView(c); val editType = look.line("", 15f)
    val phoneQr = ImageView(c); val phoneCode: TextView = look.heading("", 24f); val phoneType = look.line("", 14f, SetupLook.INK_3)
    lateinit var newCode: TextView; private set
    lateinit var forget: TextView; private set
    private lateinit var strip: LinearLayout
    private lateinit var stripText: TextView
    lateinit var stripButton: TextView; private set
    lateinit var undoButton: TextView; private set
    val helpQr = ImageView(c)
    private lateinit var watchRow: View

    init {
        root = FrameLayout(c).apply { setBackgroundColor(SetupLook.WALL); clipChildren = false }
        root.addView(look.brand(), FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
            leftMargin = look.px(48); topMargin = look.px(32)
        })
        val body = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; clipChildren = false; clipToPadding = false }
        root.addView(body, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
            leftMargin = look.px(48); rightMargin = look.px(48); topMargin = look.px(80); bottomMargin = look.px(24)
        })
        // the list
        val list = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false }
        list.addView(look.heading(SetupWords.SETTINGS, 32f).apply { setPadding(look.px(6), 0, 0, look.px(10)) })
        list.addView(row(Item.EDIT, SetupWords.EDIT_ITEM, SetupWords.EDIT_SUB))
        list.addView(row(Item.PHONE, SetupWords.PHONE_ITEM, SetupWords.phoneSub(0)))
        list.addView(row(Item.UNDO, SetupWords.UNDO_ITEM, SetupWords.UNDO_SUB))
        list.addView(View(c), LinearLayout.LayoutParams(1, 0, 1f))
        list.addView(row(Item.HELP, SetupWords.HELP_ITEM, null), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        body.addView(list, LinearLayout.LayoutParams(look.px(250), ViewGroup.LayoutParams.MATCH_PARENT))
        // the panel: one card, the focused item's content in it
        val panel = FrameLayout(c).apply {
            background = look.round(SetupLook.PAPER, 30f); clipChildren = false; clipToPadding = false
            setPadding(look.px(32), look.px(22), look.px(32), look.px(20))
        }
        body.addView(panel, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply { leftMargin = look.px(22) })
        panels[Item.EDIT] = editPanel(); panels[Item.PHONE] = phonePanel(); panels[Item.UNDO] = undoPanel(); panels[Item.HELP] = helpPanel()
        panels.values.forEach { panel.addView(it, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
        select(Item.EDIT)
    }

    /** Shows this item's panel and marks its row; Left from anything in the panel goes back to that row. */
    fun select(item: Item) {
        selected = item
        panels.forEach { (k, v) -> v.visibility = if (k == item) View.VISIBLE else View.GONE }
        rows.forEach { (k, v) -> (v.tag as? (Boolean) -> Unit)?.invoke(k == item) }
        val rowId = rows[item]!!.id
        fun leftTo(v: View) { if (v.isFocusable) v.nextFocusLeftId = rowId; if (v is ViewGroup) for (i in 0 until v.childCount) leftTo(v.getChildAt(i)) }
        leftTo(panels[item]!!)
    }
    fun row(item: Item): View = rows[item]!!
    fun setPhones(n: Int) { subs[Item.PHONE]?.text = SetupWords.phoneSub(n) }

    fun setStrip(s: Strip) {
        strip.visibility = if (s == Strip.NONE) View.GONE else View.VISIBLE
        stripText.text = if (s == Strip.FIRE) SetupWords.KEYS_STRIP_FIRE else SetupWords.KEYS_STRIP
        stripButton.visibility = if (s == Strip.STEPS) View.VISIBLE else View.GONE
    }
    fun setWatchLine(show: Boolean) { watchRow.visibility = if (show) View.VISIBLE else View.GONE }

    // ------------------------------------------------------------------------------------------- parts

    private fun row(item: Item, title: String, sub: String?): View = LinearLayout(c).apply {
        id = View.generateViewId()
        orientation = LinearLayout.VERTICAL; isFocusable = true; isClickable = true
        val help = sub == null
        val ring = look.px(4); val gap = look.px(4)
        val radius = if (help) 999f else 18f
        val outer = GradientDrawable().apply { cornerRadius = look.px(radius).toFloat() }
        val mid = GradientDrawable().apply { cornerRadius = look.px(radius).toFloat() }
        val fill = GradientDrawable().apply { cornerRadius = look.px(radius).toFloat() }
        background = LayerDrawable(arrayOf(outer, mid, fill)).apply {
            setLayerInset(1, ring, ring, ring, ring); setLayerInset(2, ring + gap, ring + gap, ring + gap, ring + gap)
        }
        var isSel = false
        var f = false
        fun paint() {
            outer.setColor(if (f) SetupLook.SUN else Color.TRANSPARENT)
            mid.setColor(if (f) SetupLook.WALL else Color.TRANSPARENT)
            fill.setColor(if (isSel || f) SetupLook.PAPER else Color.argb(153, 251, 250, 247))
        }
        tag = { s: Boolean -> isSel = s; paint() }
        val padV = if (help) 8 else 12
        setPadding(ring + gap + look.px(18), ring + gap + look.px(padV), ring + gap + look.px(18), ring + gap + look.px(padV))
        addView(TextView(c).apply { text = title; typeface = look.semiFace; setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, if (help) 15f else 17f); setTextColor(SetupLook.INK) })
        if (sub != null) addView(look.line(sub, 13f, SetupLook.INK_3).also { subs[item] = it })
        setOnFocusChangeListener { v, has ->
            f = has
            if (has) select(item)
            paint()
            v.animate().scaleX(if (has) 1.03f else 1f).scaleY(if (has) 1.03f else 1f).setDuration(140).start()
        }
        // OK on a row goes into its panel, to its first button
        setOnClickListener { panels[item]?.let { p -> firstFocusable(p)?.requestFocus() } }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = 0 }
        rows[item] = this
        paint()
    }

    private fun firstFocusable(v: View): View? {
        if (v.visibility != View.VISIBLE) return null
        if (v.isFocusable && v !is ViewGroup) return v
        if (v is ViewGroup) for (i in 0 until v.childCount) firstFocusable(v.getChildAt(i))?.let { return it }
        return null
    }

    private fun column() = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false }
    private fun h2(t: String) = look.heading(t, 28f)
    private fun para(t: String, top: Int = 8) = look.line(t, 16f).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(top) }
    }
    private fun qrBox(img: ImageView, size: Int) = LinearLayout(c).apply {
        background = look.round(Color.WHITE, 14f); gravity = Gravity.CENTER
        setPadding(look.px(7), look.px(7), look.px(7), look.px(7))
        img.scaleType = ImageView.ScaleType.FIT_CENTER
        addView(img, LinearLayout.LayoutParams(look.px(size), look.px(size)))
    }
    private fun wrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    private fun editPanel() = column().apply {
        addView(h2(SetupWords.EDIT_ITEM))
        addView(para(SetupWords.EDIT_LINE))
        val r = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        r.addView(qrBox(editQr, 160), wrap())
        val words = column()
        words.addView(look.line(SetupWords.SCAN, 17f, SetupLook.INK))
        words.addView(editType.apply { setTextColor(SetupLook.INK_3) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(10) })
        r.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = look.px(26) })
        addView(r, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(20) })
    }

    /** A picture of the real phone remote (setup-assets/phone) in a phone frame, with its page's name under it. */
    private fun phone(asset: String, name: String) = column().apply {
        gravity = Gravity.CENTER_HORIZONTAL
        val frame = FrameLayout(c).apply { background = look.round(Color.parseColor("#0B0B0D"), 18f); setPadding(look.px(4), look.px(4), look.px(4), look.px(4)) }
        val img = ImageView(c).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = look.round(Color.BLACK, 14f); clipToOutline = true
            runCatching { c.assets.open("phone/$asset").use { setImageBitmap(BitmapFactory.decodeStream(it)) } }
        }
        frame.addView(img, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(frame, LinearLayout.LayoutParams(look.px(76), look.px(164)))
        addView(look.label(name), wrap().apply { topMargin = look.px(6) })
    }

    private fun phonePanel() = column().apply {
        addView(h2(SetupWords.PHONE_TITLE))
        addView(para(SetupWords.PHONE_LINE))
        val r = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; clipChildren = false; clipToPadding = false }
        r.addView(phone("remote_page.jpg", SetupWords.PHONE_REMOTE_PAGE), wrap())
        r.addView(phone("watch_page.jpg", SetupWords.PHONE_WATCH_PAGE), wrap().apply { leftMargin = look.px(12) })
        val q = column()
        q.addView(qrBox(phoneQr, 92), wrap())
        q.addView(phoneCode, wrap().apply { topMargin = look.px(6) })
        q.addView(phoneType, wrap().apply { topMargin = look.px(2) })
        newCode = look.pill(SetupWords.NEW_CODE, SetupLook.Kind.GHOST, small = true) { on.newCode() }
        forget = look.pill(SetupWords.FORGET_PHONES, SetupLook.Kind.GHOST, small = true) { on.forgetPhones() }
        q.addView(look.actions(newCode, forget).apply { (layoutParams as LinearLayout.LayoutParams).topMargin = look.px(4) })
        r.addView(q, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = look.px(24) })
        addView(r, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(8) })
        strip = LinearLayout(c).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; clipChildren = false; clipToPadding = false
            background = look.round(Color.argb(41, 255, 200, 30), 18f)
            setPadding(look.px(16), look.px(4), look.px(6), look.px(4))
        }
        stripText = look.line(SetupWords.KEYS_STRIP, 14f, SetupLook.INK)
        strip.addView(stripText, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { topMargin = look.px(8); bottomMargin = look.px(8) })
        stripButton = look.pill(SetupWords.KEYS_STRIP_BUTTON, SetupLook.Kind.INK, small = true, surface = Color.rgb(253, 244, 214)) { on.keys() }
        strip.addView(stripButton)
        addView(strip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(12) })
    }

    private fun undoPanel() = column().apply {
        addView(h2(SetupWords.UNDO_TITLE))
        addView(para(SetupWords.UNDO_LINE))
        undoButton = look.pill(SetupWords.UNDO_ITEM, SetupLook.Kind.INK) { on.undo() }
        addView(look.actions(undoButton))
        addView(look.line(SetupWords.UNDO_NOTE, 15f, SetupLook.INK_3), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(18) })
    }

    private fun helpPanel() = column().apply {
        addView(h2(SetupWords.HELP_ITEM))
        addView(para(SetupWords.HELP_LINE))
        val r = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        r.addView(qrBox(helpQr, 150), wrap())
        r.addView(look.line("Or visit\n${SetupWords.HELP_SITE}", 15f, SetupLook.INK_3), wrap().apply { leftMargin = look.px(26) })
        addView(r, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(20) })
        // the Home button version only, while its watch is off: where to switch it on
        watchRow = column().apply {
            addView(look.line(SetupWords.WATCH_LINE, 15f, SetupLook.INK))
            addView(look.actions(look.pill(SetupWords.WATCH_BUTTON, SetupLook.Kind.GHOST, small = true) { on.accessibility() }))
            visibility = View.GONE
        }
        addView(watchRow, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(18) })
    }

    companion object {
        /** The help site's QR, made once. */
        fun helpQr(): Bitmap? = SetupScreens.qrBitmap(SetupWords.HELP_URL)
    }
}
