plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.couchtv.ontv"
    compileSdk = 34
    defaultConfig {
        applicationId = "dev.couchtv.ontv"
        minSdk = 23          // Android 6.0. Wireless debugging pairing needs Android 11+ on the TV.
        targetSdk = 34
        versionCode = 28
        versionName = "0.13.15"
    }
    buildFeatures { buildConfig = true }
    // Test builds: when COUCHTV_KEYSTORE names a keystore (a debug-style key, alias androiddebugkey,
    // password android), release builds are signed with it, so one test build can update the last (#4).
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
            // Not minified: libadb, Conscrypt and BouncyCastle use reflection, and the size saving is small.
            isMinifyEnabled = false
            // Signed with the local debug key so it installs without a keystore. Use your own key to publish.
            signingConfig = signingConfigs.findByName("fixed") ?: signingConfigs.getByName("debug")
        }
        // couch-tv-ontv-watch.apk: the release plus the home watch (src/watch/AndroidManifest.xml), for a
        // computer to install (Fire TV). The plain release has no accessibility service, so Play Protect
        // lets a phone only install from Downloader through.
        create("watch") {
            initWith(getByName("release"))
            matchingFallbacks += listOf("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging {
        resources { excludes += setOf("META-INF/versions/9/OSGI-INF/MANIFEST.MF", "META-INF/*.kotlin_module") }
        // One APK for every TV, never one per processor: Downloader's code 8180170, the
        // latest/download/couch-tv-ontv.apk link, couch-tv Setup and Studio cannot ask a TV which it has.
        // The native libraries (Matter's controller, Conscrypt) go in compressed, so the download is
        // much smaller than with stored ones; Android unpacks only this TV's own set when it installs.
        // The measured sizes and every rule a release must keep: scripts/check-release-apks.py.
        jniLibs { useLegacyPackaging = true }
    }
    // Matter controller (connectedhomeip v1.6.1.0, built by scripts/matter/build-controller.sh, on-tv/android/matter/README.md):
    // the native library per processor, and the PAA roots that check a device was certified.
    sourceSets["main"].jniLibs.srcDir("../matter/jni")
    sourceSets["main"].assets.srcDir("../matter/assets")
    // The setup screen's fonts: static cuts of the couch-tv Studio site's Nunito Black and Inter (SIL Open Font
    // Licence 1.1, setup-assets/fonts/README.md). Not in src/main/assets, which copyWeb clears and git ignores.
    sourceSets["main"].assets.srcDir("setup-assets")
    // SetupShotsTest draws the setup screens on a computer (Robolectric), so it needs the app's own resources.
    testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
    // HTTP + WebSocket server (Apache 2.0 / BSD).
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("org.nanohttpd:nanohttpd-websocket:2.3.1")
    // ADB client that runs on Android: plain TCP (5555), TLS, and wireless-debugging pairing (Apache 2.0 or GPL 3).
    implementation("com.github.MuntashirAkon:libadb-android:3.1.1")
    // TLS 1.3 for wireless debugging on every Android version, without hidden-API tricks.
    implementation("org.conscrypt:conscrypt-android:2.5.3")
    // Makes the self-signed certificate the ADB TLS handshake needs.
    implementation("org.bouncycastle:bcpkix-jdk15to18:1.81")
    // Matter controller jars (Apache 2.0), from the same build as the native library (on-tv/android/matter/)
    implementation(fileTree(mapOf("dir" to "../matter/libs", "include" to listOf("*.jar"))))
    // Unit tests for the plain Kotlin rules (KeepMergeTest), run with testDebugUnitTest (EPL 1.0).
    testImplementation("junit:junit:4.13.2")
    // A real org.json for the tests that read and build JSON (AskWireTest): Android's own copy is only a stub on a computer (JSON licence).
    testImplementation("org.json:json:20240303")
    // SetupShotsTest: the setup screens drawn on a computer, with Android's own graphics (MIT).
    testImplementation("org.robolectric:robolectric:4.14.1")
}

// On a computer, Robolectric starts Conscrypt from its own desktop build (conscrypt-openjdk-uber, native code for Linux, macOS
// and Windows inside). The app's conscrypt-android has the same classes but looks for libconscrypt_jni on the Java library
// path, which only exists on a phone or TV: with both on the test classpath, every Robolectric test (SetupShotsTest, VoiceKeysTest)
// failed on the Linux CI runner with "no conscrypt_jni in java.library.path". Leave the Android one out of the unit-test run only.
configurations.matching { it.name.endsWith("UnitTestRuntimeClasspath") }.configureEach {
    exclude(group = "org.conscrypt", module = "conscrypt-android")
}

// The phone remote and the TV home are built elsewhere in the repo. Copy them in before every build.
// Order: -PremoteDist=..., then the repo layout (on-tv/ next to remote/), then a staging copy in ../repo.
val repoRoot = listOf(file("../../.."), file("../../../repo")).firstOrNull { File(it, "remote/dist/index.html").isFile } ?: file("../../..")
val remoteDist = (project.findProperty("remoteDist") as String?)?.let { file(it) } ?: File(repoRoot, "remote/dist")
val tvHomeWeb = (project.findProperty("tvHomeWeb") as String?)?.let { file(it) } ?: File(repoRoot, "tv-home/web")

val copyWeb by tasks.registering(Copy::class) {
    description = "Copies the phone remote, the TV home page and the on-TV web files into assets."
    into(layout.projectDirectory.dir("src/main/assets/www"))
    from(remoteDist) { into("remote") }
    from(tvHomeWeb) { into("tv"); exclude("mock.js") }
    // tv-home/web/loop/: the Loop look's footage and stills (up to 80 MB, scripts/make-loop.sh), git
    // ignored and only ever shown from the bridge; the on-TV app never uses them, so they stay out.
    val tvLoop = File(tvHomeWeb, "loop").absoluteFile.normalize()
    exclude { it.file.absoluteFile.normalize().startsWith(tvLoop) }
    from(file("../../web")) { into("ontv") }
    doFirst {
        if (!File(remoteDist, "index.html").isFile) throw GradleException("No phone remote build at $remoteDist. Run npm run build in remote/ first.")
        if (!File(tvHomeWeb, "index.html").isFile) throw GradleException("No TV home page at $tvHomeWeb.")
        delete(layout.projectDirectory.dir("src/main/assets/www"))
    }
}
tasks.named("preBuild") { dependsOn(copyWeb) }

// Smart home (Home Assistant, signed in from a phone): the same code as the launcher's,
// tv-home/android/shared/java (package app.couchtv.ha), served here by Server.kt (/ha, /api/ha).
android.sourceSets.getByName("main").java.srcDir(File(repoRoot, "tv-home/android/shared/java"))
android.sourceSets.getByName("test").java.srcDir(File(repoRoot, "tv-home/android/shared/test"))

// -PsetupShots=<folder>: SetupShotsTest saves PNGs of the setup screens there (skipped without it).
tasks.withType<Test>().configureEach {
    systemProperty("setupShots", (project.findProperty("setupShots") as String?) ?: "")
    testLogging { exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

// ------------------------------------------------------------------------------------------- Google Play
// Product flavours, dimension "store" (coord/GOOGLE-PLAY-PLAN.md section 4, coord/GOOGLE-PLAY-BUILD.md):
//  github  today's builds, unchanged: githubRelease is couch-tv-ontv.apk, githubWatch couch-tv-ontv-watch.apk.
//  play    the Google Play App Bundle, TV only: bundlePlayRelease. src/play/ (manifest overlay, the watch's
//          accessibility config without key filtering) and PlayRules.kt (BuildConfig.FLAVOR == "play").
// versionCode play = 1,000,000 + 100 x the GitHub versionCode of the same source + PLAY_REBUILD (0 to 99, for
// Play only rebuilds): always above every GitHub build, so a TV can move from GitHub to Play once both share a
// signing key, and a GitHub APK can never replace a Play install. PlayRules.versionCode is the same formula.
// targetSdk 34 for both: Google Play's floor for Android TV apps (since 31 Aug 2025); the Play build is TV only.
val PLAY_REBUILD = 0
val PLAY_VERSION_NAME = "0.13.15"   // the GitHub versionName of the same source
android.flavorDimensions += "store"
android.productFlavors.create("github") { dimension = "store"; isDefault = true }
android.productFlavors.create("play") {
    dimension = "store"
    versionCode = 1_000_000 + 100 * (android.defaultConfig.versionCode ?: 0) + PLAY_REBUILD
    versionName = PLAY_VERSION_NAME
}
androidComponents {
    // the watch build type is a GitHub APK only: the Play build has the watch inside
    beforeVariants(selector().withFlavor("store" to "play").withBuildType("watch")) { it.enable = false }
}
// -PplayAssets=<folder>: PlayAssetsTest (testPlayDebugUnitTest) draws the draft Play graphics there (skipped without it).
tasks.withType<Test>().configureEach { systemProperty("playAssets", (project.findProperty("playAssets") as String?) ?: "") }
// testDebugUnitTest (CI, the docs) runs both flavours' unit tests, as it ran the one build before.
tasks.register("testDebugUnitTest") { dependsOn("testGithubDebugUnitTest", "testPlayDebugUnitTest") }
