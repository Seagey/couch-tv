package dev.couchtv.ontv

import android.webkit.JavascriptInterface

/**
 * window.TVPLAY on the TV home, added by HomeActivity in the Google Play build only (PlayRules.askAi): the page
 * (tv-home/web/ask.js) opens no Ask sheet, and an Ask AI widget in a design says it is not in this version.
 * The owner chose to leave Ask AI out of the first Play build (coord/GOOGLE-PLAY-BUILD.md); the GitHub builds keep it.
 */
class PlayPage {
    @JavascriptInterface fun askOff(): Boolean = !PlayRules.askAi(BuildConfig.FLAVOR)
}
