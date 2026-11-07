// Tests only: a fake streaming app for the Keep watching simulation on an emulator (README.md).
// Signed with a throwaway key made in build/, never the couch-tv key, so it can never replace the
// real app whose package name it borrows.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val fakeId = (project.findProperty("fakeId") as String?) ?: "com.netflix.ninja"
val fakeKey = file("../build/fake.keystore")

android {
    namespace = "dev.couchtv.fakeplayer"
    compileSdk = 34
    defaultConfig {
        applicationId = fakeId
        minSdk = 25
        targetSdk = 34
        versionCode = 1
        versionName = "test"
    }
    signingConfigs {
        create("fake") {
            storeFile = fakeKey
            storePassword = "fakeplayer"
            keyAlias = "fakeplayer"
            keyPassword = "fakeplayer"
        }
    }
    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("fake") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
