# The page calls these through window.TVOS.
-keepclassmembers class app.couchtv.launcher.MainActivity$Native {
    @android.webkit.JavascriptInterface <methods>;
}

# Smart home: the page calls these through window.TVHA (HomeAssistant.kt).
-keepclassmembers class app.couchtv.launcher.HomeAssistant$Page {
    @android.webkit.JavascriptInterface <methods>;
}

# Updates: the page calls these through window.TVUP (Updater.kt).
-keepclassmembers class app.couchtv.launcher.Updater$Page {
    @android.webkit.JavascriptInterface <methods>;
}
