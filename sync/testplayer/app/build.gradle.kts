// Tests only: a small video player with a MediaSession, for trying the sync helper on an emulator.
// It never goes on a real TV. Signed with the debug key.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.couchtv.synctest"
    compileSdk = 34
    defaultConfig {
        applicationId = "dev.couchtv.synctest"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "test"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
