plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.couchtv.ontv"
    compileSdk = 34
    defaultConfig {
        applicationId = "dev.couchtv.ontv"
        minSdk = 28          // Android 9. Wireless debugging pairing needs Android 11+ on the TV.
        targetSdk = 34
        versionCode = 2
        versionName = "0.2"
    }
    buildFeatures { buildConfig = true }
    buildTypes {
        release {
            // Not minified: libadb, Conscrypt and BouncyCastle use reflection, and the size saving is small.
            isMinifyEnabled = false
            // Signed with the local debug key so it installs without a keystore. Use your own key to publish.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources { excludes += setOf("META-INF/versions/9/OSGI-INF/MANIFEST.MF", "META-INF/*.kotlin_module") } }
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
    from(file("../../web")) { into("ontv") }
    doFirst {
        if (!File(remoteDist, "index.html").isFile) throw GradleException("No phone remote build at $remoteDist. Run npm run build in remote/ first.")
        if (!File(tvHomeWeb, "index.html").isFile) throw GradleException("No TV home page at $tvHomeWeb.")
        delete(layout.projectDirectory.dir("src/main/assets/www"))
    }
}
tasks.named("preBuild") { dependsOn(copyWeb) }
