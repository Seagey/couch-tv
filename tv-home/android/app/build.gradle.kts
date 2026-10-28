import groovy.json.JsonOutput
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.couchtv.launcher"
    compileSdk = 34
    defaultConfig {
        applicationId = "app.couchtv.launcher"
        minSdk = 28
        targetSdk = 34
        versionCode = 4
        versionName = "0.2"
        // Where the bridge might be: ./gradlew assembleRelease -PbridgeUrls=http://my-computer.local:5400
        // (comma separated, more than one is fine). The last one that answered is remembered on the TV.
        // Without it, apply.sh tells the app the address when it installs (the "bridge" extra), and
        // with no address at all (option A) the copy of the home built into the app is the home.
        val urls = (project.findProperty("bridgeUrls") as String? ?: "").split(",").map { it.trim() }.filter { it.isNotEmpty() }
        buildConfigField("String[]", "BRIDGES", "{" + urls.joinToString(", ") { "\"" + it + "\"" } + "}")
    }
    buildFeatures { buildConfig = true }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

/**
 * Copies tv-home/web into the app as assets/www/tv, plus a config.js made from config.json, so the
 * home works with no computer at all (option A). The settings file is -PconfigJson=<path>, else
 * config.json in the repo root, else config.example.json. apply.sh can hand the TV newer settings
 * later without a rebuild. Only the parts the TV home shows are copied: people, weather, the
 * home's look and each TV's quick buttons. Never secrets.
 */
abstract class BundleTvWeb : DefaultTask() {
    @get:InputDirectory
    abstract val web: DirectoryProperty

    @get:InputFile
    abstract val configJson: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun run() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        val dest = File(out, "www/tv")
        val src = web.get().asFile
        src.walkTopDown().filter { it.isFile }.forEach { f ->
            val rel = f.relativeTo(src).path
            // development only, or not part of the page
            if (rel == "mock.js" || rel.endsWith(".md") || f.name.startsWith(".")) return@forEach
            f.copyTo(File(dest, rel), overwrite = true)
        }
        File(dest, "config.js").writeText("window.COUCH_CONFIG = " + JsonOutput.toJson(publicConfig(configJson.get().asFile)) + ";\n")
    }

    private fun slug(s: Any?, fallback: String): String =
        Regex("[^a-z0-9]+").replace(s.toString().lowercase(), "-").trim('-').take(32).ifEmpty { fallback }

    @Suppress("UNCHECKED_CAST")
    private fun publicConfig(file: File): Map<String, Any?> {
        val c = JsonSlurper().parse(file) as Map<String, Any?>
        val people = mutableListOf<Map<String, Any?>>()
        for (p in (c["people"] as? List<Any?>) ?: emptyList<Any?>()) {
            val m: Map<String, Any?> = when (p) {
                is String -> mapOf("name" to p)
                is Map<*, *> -> p as Map<String, Any?>
                else -> continue
            }
            val name = m["name"]?.toString()?.trim().orEmpty()
            if (name.isEmpty() || people.size >= 12) continue
            val item = linkedMapOf<String, Any?>("id" to ((m["id"] as? String) ?: slug(name, "person")), "name" to name)
            (m["colour"] as? String)?.let { item["colour"] = it }
            people.add(item)
        }
        val tvs = (c["tvs"] as? List<Map<String, Any?>> ?: emptyList()).map { t ->
            mapOf("id" to t["id"], "name" to t["name"], "quick" to (t["quick"] as? List<Any?> ?: listOf("sleep")),
                "picture_modes" to emptyList<String>())
        }
        return mapOf(
            "people" to people,
            "weather" to c["weather"],
            "home" to (c["home"] ?: emptyMap<String, Any?>()),
            "tvs" to tvs,
            "default_tv" to (c["default_tv"] ?: tvs.firstOrNull()?.get("id")),
            "ask" to mapOf("enabled" to false),
            "phone_remote" to false,
        )
    }
}

val repoRoot = rootProject.projectDir.resolve("../..")
val configFile: File = (project.findProperty("configJson") as String?)?.let { file(it) }
    ?: repoRoot.resolve("config.json").takeIf { it.isFile }
    ?: repoRoot.resolve("config.example.json")

val bundleTvWeb = tasks.register<BundleTvWeb>("bundleTvWeb") {
    web.set(rootProject.layout.projectDirectory.dir("../web"))
    configJson.set(configFile)
    outputDir.set(layout.buildDirectory.dir("generated/tvweb"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(bundleTvWeb, BundleTvWeb::outputDir)
    }
}
