package dev.couchtv.ontv

import android.graphics.Bitmap
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The approved setup screens (owner, 23 Nov 2026, from the mockups): step 1, step 2, the ready screen for
 * later opens, and the More help screen behind step 1. Built from SetupLook with no Android state in them,
 * so SetupActivity fills them in and SetupShotsTest draws them on a computer.
 */
class SetupScreens(val look: SetupLook) {
    /** One step screen and the parts SetupActivity changes while it is up. */
    class Step(val root: View, val line: TextView, val primary: TextView, val second: TextView?, val chip: TextView?, val settings: TextView?)

    /**
     * step: 1 or 2 for "Step n of 2", or 0 for none (the ready screen). second: the quieter button (null: none).
     * chip: the green note under the button (null: none). settings: the small Settings button top right.
     */
    fun step(step: Int, title: String, line: String, primary: String, onPrimary: () -> Unit,
             second: String? = null, secondKind: SetupLook.Kind = SetupLook.Kind.GHOST, onSecond: () -> Unit = {},
             chip: String? = null, note: Pair<String, String>? = null, settings: (() -> Unit)? = null,
             of: Int = 2, label: String? = null, primaryKind: SetupLook.Kind = SetupLook.Kind.INK, extra: View? = null,
             after: String? = null, side: View? = null): Step {
        val card = look.card()
        if (step > 0) card.addView(look.eyebrow(step, of, label ?: SetupWords.stepOf(step, of)), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = look.px(18) })
        // a long heading a size down, so it stays on one line in the card
        card.addView(look.heading(title, if (title.length > 26) 38f else 42f))
        val words = look.line(line)
        card.addView(words, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(14) })
        if (line.isEmpty()) words.visibility = View.GONE
        if (extra != null) card.addView(extra)
        val main = look.pill(primary, primaryKind, on = onPrimary)
        val other = second?.let { look.pill(it, secondKind, small = secondKind == SetupLook.Kind.LINK, on = onSecond) }
        val done = chip?.let { look.doneChip(it) }
        // a chip with words after it (the key walk-through's end): the chip, the words, then the buttons
        if (done != null && after != null) {
            card.addView(done)
            card.addView(look.line(after), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(20) })
        }
        val row = if (other != null) look.actions(main, other) else look.actions(main)
        // something beside the buttons (the walk-through's pairing QR), pushed to the right end
        if (side != null) { (row.layoutParams as LinearLayout.LayoutParams).width = ViewGroup.LayoutParams.MATCH_PARENT; row.addView(View(look.c), LinearLayout.LayoutParams(0, 1, 1f)); row.addView(side) }
        card.addView(row)
        if (done != null && after == null) card.addView(done)
        if (note != null) card.addView(look.note(note.first, note.second))
        val corner = settings?.let { look.pill(SetupWords.SETTINGS, SetupLook.Kind.GHOST, small = true, surface = SetupLook.WALL, on = it) }
        return Step(look.screen(card, corner), words, main, other, done, corner)
    }

    /** More help behind step 1: why the Home button stays, the two ways round it, the help page's QR. */
    fun help(reason: String, qr: Bitmap?, onKeys: () -> Unit, onBack: () -> Unit): Step {
        val card = look.card(width = 780, padH = 44, padV = 32)
        card.addView(look.label(SetupWords.MORE_HELP), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = look.px(12) })
        val row = LinearLayout(look.c).apply { orientation = LinearLayout.HORIZONTAL }
        val words = LinearLayout(look.c).apply { orientation = LinearLayout.VERTICAL }
        words.addView(look.heading(SetupWords.HELP_TITLE, 34f))
        val first = look.line(SetupWords.helpLine(reason), 17f)
        words.addView(first, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(12) })
        SetupWords.HELP_WAYS.forEachIndexed { i, w ->
            words.addView(look.line("${i + 1}.  $w", 16f), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(8) })
        }
        row.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (qr != null) row.addView(qrBox(qr, 150), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = look.px(28) })
        card.addView(row)
        val main = look.pill(SetupWords.HELP_KEYS_BUTTON, SetupLook.Kind.INK, on = onKeys)
        val back = look.pill(SetupWords.BACK, SetupLook.Kind.GHOST, on = onBack)
        card.addView(look.actions(main, back))
        return Step(look.screen(card), first, main, back, null, null)
    }

    companion object {
        /** A QR code (Qr.kt, the same code as the home page draws), black on white with a quiet zone. */
        fun qrBitmap(text: String): Bitmap? = runCatching {
            val m = Qr.matrix(text); val q = 4; val n = m.size + q * 2; val scale = 8
            val bmp = Bitmap.createBitmap(n * scale, n * scale, Bitmap.Config.RGB_565)
            bmp.eraseColor(android.graphics.Color.WHITE)
            val px = IntArray(scale * scale) { android.graphics.Color.BLACK }
            for (y in m.indices) for (x in m.indices) if (m[y][x]) bmp.setPixels(px, 0, scale, (x + q) * scale, (y + q) * scale, scale, scale)
            bmp
        }.getOrNull()
    }

    /** A QR code on white, rounded, with room round it. */
    fun qrBox(qr: Bitmap, sizeDp: Int) = LinearLayout(look.c).apply {
        gravity = Gravity.CENTER
        background = look.round(android.graphics.Color.WHITE, 18f)
        setPadding(look.px(10), look.px(10), look.px(10), look.px(10))
        addView(ImageView(look.c).apply { setImageBitmap(qr); scaleType = ImageView.ScaleType.FIT_CENTER },
            LinearLayout.LayoutParams(look.px(sizeDp), look.px(sizeDp)))
    }
}
