// The sync helper (dev.couchtv.sync). Signed with the debug key in ~/.android/debug.keystore, the
// same as the other couch-tv apps (scripts/build-apk.sh). Build: sync/build.sh
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.couchtv.sync"
    compileSdk = 34
    defaultConfig {
        applicationId = "dev.couchtv.sync"
        minSdk = 25
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
    }
    // Test builds: when COUCHTV_KEYSTORE names a keystore (a debug-style key, alias androiddebugkey,
    // password android), release builds are signed with it, the same as the other couch-tv apps.
    val fixedKey = System.getenv("COUCHTV_KEYSTORE")?.let { file(it) }?.takeIf { it.isFile }
    signingConfigs {
        if (fixedKey != null) create("fixed") {
            storeFile = fixedKey
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("fixed") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
