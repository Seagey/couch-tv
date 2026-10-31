package dev.couchtv.ontv

import android.app.Activity
import android.content.Intent
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * The TV home screen: the same page as the computer-bridge mode (tv-home/web), served by this
 * app's own server at 127.0.0.1. It is the home screen only when "Use as home screen" is switched
 * on in setup (the HOME filter is on an alias that is off by default).
 */
class HomeActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var ready = false
    private val banners = ConcurrentHashMap<String, ByteArray>()
    private val icons = ConcurrentHashMap<String, ByteArray>()
    private val base get() = "http://127.0.0.1:${Store.port}"

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        App.startService(this)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setCookie(base, "couchtv_token=${Auth.internalToken}; path=/")
        val w = WebView(this).apply {
            setBackgroundColor(GROUND)
            isFocusable = true; isFocusableInTouchMode = true
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.textZoom = 100
            addJavascriptInterface(Native(), "TVOS")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) { ready = true; view.requestFocus() }
                override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                    // The server may still be starting: try again shortly.
                    if (req.isForMainFrame) { ready = false; main.postDelayed({ load() }, 700) }
                }
                // Only the home page itself may load here: its restart() (a new look, scenes, timer)
                // reloads it with location.replace, which was cancelled along with everything else.
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest) = !req.url.toString().startsWith("$base/tv/")
                override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                    val u = req.url
                    if (u.host != "tvos.invalid") return null
                    val pkg = u.lastPathSegment ?: return null
                    val isIcon = u.pathSegments.firstOrNull() == "icon"
                    val img = (if (isIcon) iconImage(pkg) else bannerImage(pkg)) ?: return null
                    return WebResourceResponse(if (isIcon) "image/png" else "image/jpeg", null, ByteArrayInputStream(img))
                }
            }
        }
        web = w
        setContentView(w)
        hideBars()
        load()
    }

    private fun load() { web?.loadUrl("$base/tv/") }

    override fun onResume() { super.onResume(); hideBars(); if (ready) js("window.tv && tv.resume()") }
    override fun onNewIntent(i: Intent) { super.onNewIntent(i); js("window.tv && tv.home()") }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        if (e.keyCode == KeyEvent.KEYCODE_BACK) { if (e.action == KeyEvent.ACTION_UP && ready) js("window.tv && tv.back()"); return true }
        // Long press MENU opens setup, so the home screen can always reach it.
        if (e.keyCode == KeyEvent.KEYCODE_MENU && e.action == KeyEvent.ACTION_UP && e.isLongPress) { startActivity(Intent(this, SetupActivity::class.java)); return true }
        return super.dispatchKeyEvent(e)
    }

    private fun js(code: String) { web?.takeIf { ready }?.evaluateJavascript(code, null) }

    private fun hideBars() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.decorView.windowInsetsController?.let {
                it.hide(WindowInsets.Type.systemBars()); it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            // Android 9 and 10 (many Fire TV sticks and older Android TVs) only have the old flags
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    // ---------------------------------------------------------------- what the page can ask for (window.TVOS)

    inner class Native {
        @JavascriptInterface fun apps(): String {
            val out = JSONArray()
            for (ri in tvApps()) {
                val ai = ri.activityInfo
                out.put(JSONObject().put("package", ai.packageName).put("label", ri.loadLabel(packageManager).toString())
                    .put("hasBanner", ai.banner != 0 || ai.applicationInfo.banner != 0))
            }
            return out.toString()
        }
        @JavascriptInterface fun launch(pkg: String): Boolean {
            val i = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg) ?: return false
            main.post { runCatching { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
            return true
        }
        @JavascriptInterface fun openSettings(): Boolean = runCatching { Tv.openSettings() }.isSuccess
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun keep(key: String, value: String) { getSharedPreferences("page", MODE_PRIVATE).edit().putString(key, value).apply() }
        @JavascriptInterface fun kept(key: String): String? = getSharedPreferences("page", MODE_PRIVATE).getString(key, null)
    }

    private fun tvApps(): List<ResolveInfo> = Tv.tvLaunchables().filter { it.activityInfo.packageName != packageName }
        .sortedBy { it.loadLabel(packageManager).toString().lowercase() }

    // ---------------------------------------------------------------- app tiles (same drawing as the computer-bridge launcher)

    private fun bannerImage(pkg: String): ByteArray? {
        banners[pkg]?.let { return it }
        val ri = tvApps().firstOrNull { it.activityInfo.packageName == pkg } ?: return null
        val bmp = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(FLAP)
        val banner = ri.activityInfo.loadBanner(packageManager) ?: ri.activityInfo.applicationInfo.loadBanner(packageManager)
        if (banner != null) { banner.setBounds(0, 0, 640, 360); banner.draw(c) } else iconTile(ri.loadIcon(packageManager), c)
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 90, it); bmp.recycle() }.toByteArray()
        banners[pkg] = bytes
        return bytes
    }

    private fun iconTile(icon: Drawable, c: Canvas) {
        val n = 432
        val sq = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
        val sc = Canvas(sq)
        if (icon is AdaptiveIconDrawable) {
            icon.background?.apply { setBounds(0, 0, n, n); draw(sc) }; icon.foreground?.apply { setBounds(0, 0, n, n); draw(sc) }
        } else { icon.setBounds(0, 0, n, n); icon.draw(sc) }
        val edge = sq.getPixel(2, n / 2)
        c.drawColor(edge)
        val size = 220
        c.drawBitmap(sq, null, android.graphics.Rect(320 - size / 2, 180 - size / 2, 320 + size / 2, 180 + size / 2), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        sq.recycle()
    }

    private fun iconImage(pkg: String): ByteArray? {
        icons[pkg]?.let { return it }
        val d = try { packageManager.getApplicationIcon(pkg) } catch (e: Exception) { return null }
        val bmp = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, 128, 128); d.draw(Canvas(bmp))
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it); bmp.recycle() }.toByteArray()
        icons[pkg] = bytes
        return bytes
    }

    companion object {
        private val GROUND = Color.parseColor("#0D1E19")
        private val FLAP = Color.parseColor("#131614")
    }
}
