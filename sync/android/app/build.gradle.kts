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
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
