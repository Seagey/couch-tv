package app.couchtv.launcher

import android.app.Activity
import android.app.Presentation
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.DisplayMetrics
import android.view.KeyEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import org.json.JSONObject

class SharpScreen private constructor(
    private val activity: Activity,
    private val display: VirtualDisplay,
    private val presentation: Presentation,
    private val surface: SurfaceView,
) : SurfaceHolder.Callback {

    val pageContext: Context get() = presentation.context
    val pageHost = FrameLayout(presentation.context)
    val keyboardBridge = KeyboardBridge()
    private val keyboard = EditText(activity)
    private val main = Handler(Looper.getMainLooper())
    private var page: WebView? = null
    private var mirroring = false

    private fun attach(root: FrameLayout, background: Int) {
        surface.holder.addCallback(this)
        root.addView(surface, 0, FrameLayout.LayoutParams(MATCH, MATCH))
        pageHost.setBackgroundColor(background)
        presentation.setContentView(pageHost)
        presentation.show()
        keyboard.alpha = 0f
        keyboard.isSingleLine = true
        keyboard.setBackgroundColor(Color.TRANSPARENT)
        keyboard.isFocusable = false
        keyboard.isFocusableInTouchMode = false
        keyboard.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) { if (!mirroring) mirrorToPage(s?.toString() ?: "") }
        })
        keyboard.setOnEditorActionListener { _, _, _ -> pressEnterOnPage(); true }
        root.addView(keyboard, FrameLayout.LayoutParams(1, 1))
    }

    fun use(web: WebView) { page = web }

    fun close() {
        surface.holder.removeCallback(this)
        runCatching { presentation.dismiss() }
        display.release()
    }

    fun typingTakes(event: KeyEvent): Boolean = keyboard.isFocused && (event.isPrintingKey ||
        event.keyCode == KeyEvent.KEYCODE_DEL || event.keyCode == KeyEvent.KEYCODE_FORWARD_DEL ||
        event.keyCode == KeyEvent.KEYCODE_SPACE)

    fun hookKeyboard(web: WebView) = web.evaluateJavascript(KEYBOARD_HOOK, null)

    override fun surfaceCreated(holder: SurfaceHolder) { display.surface = holder.surface }
    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) { display.surface = holder.surface }
    override fun surfaceDestroyed(holder: SurfaceHolder) { display.surface = null }

    private fun showKeyboard(value: String, type: String, enterHint: String) {
        mirroring = true
        keyboard.inputType = if (type == "url") InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
        keyboard.imeOptions = (if (enterHint == "search") EditorInfo.IME_ACTION_SEARCH else EditorInfo.IME_ACTION_DONE) or
            EditorInfo.IME_FLAG_NO_EXTRACT_UI or EditorInfo.IME_FLAG_NO_FULLSCREEN
        keyboard.setText(value)
        keyboard.setSelection(value.length)
        mirroring = false
        keyboard.isFocusable = true
        keyboard.isFocusableInTouchMode = true
        keyboard.requestFocus()
        activity.getSystemService(InputMethodManager::class.java)?.showSoftInput(keyboard, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun hideKeyboard() {
        if (!keyboard.isFocused) return
        activity.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(keyboard.windowToken, 0)
        keyboard.clearFocus()
        keyboard.isFocusable = false
        keyboard.isFocusableInTouchMode = false
    }

    private fun mirrorToPage(value: String) {
        page?.evaluateJavascript("(function(v){var a=document.activeElement;if(a&&'value' in a&&a.value!==v){a.value=v;" +
            "a.dispatchEvent(new Event('input',{bubbles:true}))}})(${JSONObject.quote(value)})", null)
    }

    private fun pressEnterOnPage() {
        val web = page ?: return
        web.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
        web.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
    }

    inner class KeyboardBridge {
        @JavascriptInterface fun show(value: String?, type: String?, enterHint: String?) {
            main.post { showKeyboard(value ?: "", type ?: "text", enterHint ?: "") }
        }

        @JavascriptInterface fun hide() { main.post { hideKeyboard() } }
    }

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        const val KEYBOARD_NAME = "TVKB"
        private const val KEYBOARD_HOOK = "(function(){if(window.__tvkb)return;window.__tvkb=1;" +
            "function ed(e){return e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable)}" +
            "function show(e){TVKB.show(e.value||'',e.type||'text',e.getAttribute('enterkeyhint')||'')}" +
            "document.addEventListener('focusin',function(e){if(ed(e.target))show(e.target)},true);" +
            "document.addEventListener('focusout',function(e){if(ed(e.target))TVKB.hide()},true);" +
            "if(ed(document.activeElement))show(document.activeElement)})()"

        fun open(activity: Activity, root: FrameLayout, background: Int): SharpScreen? {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
            return try {
                @Suppress("DEPRECATION") val shown = activity.windowManager.defaultDisplay
                val metrics = DisplayMetrics().also { @Suppress("DEPRECATION") shown.getRealMetrics(it) }
                val panelWidth = shown.mode.physicalWidth
                val panelHeight = shown.mode.physicalHeight
                if (panelWidth <= metrics.widthPixels) return null
                val dpi = metrics.densityDpi * panelWidth / metrics.widthPixels
                val manager = activity.getSystemService(DisplayManager::class.java) ?: return null
                val display = manager.createVirtualDisplay("couch-tv-sharp", panelWidth, panelHeight, dpi, null, 0) ?: return null
                val surface = SurfaceView(activity).apply {
                    holder.setFormat(PixelFormat.RGBA_8888)
                    holder.setFixedSize(panelWidth, panelHeight)
                }
                SharpScreen(activity, display, Presentation(activity, display.display), surface).also { it.attach(root, background) }
            } catch (e: Exception) {
                android.util.Log.w("couchtv", "native resolution page unavailable: ${e.message}")
                null
            }
        }
    }
}
