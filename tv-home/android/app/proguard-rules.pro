# The page calls these through window.TVOS.
-keepclassmembers class app.couchtv.launcher.MainActivity$Native {
    @android.webkit.JavascriptInterface <methods>;
}

# Smart home: the page calls these through window.TVHA (HaPage.kt).
-keepclassmembers class app.couchtv.launcher.HaPage {
    @android.webkit.JavascriptInterface <methods>;
}

# Matter: the page calls these through window.TVMATTER (MatterPage.kt).
-keepclassmembers class app.couchtv.launcher.MatterPage {
    @android.webkit.JavascriptInterface <methods>;
}
# The Matter controller's native library finds its Java classes, methods and fields by name.
-keep class chip.** { *; }
-keep class matter.** { *; }
-dontwarn chip.**
-dontwarn matter.**

# Updates: the page calls these through window.TVUP (Updater.kt).
-keepclassmembers class app.couchtv.launcher.Updater$Page {
    @android.webkit.JavascriptInterface <methods>;
}
