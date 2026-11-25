plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val mobileVersion = providers.fileContents(rootProject.layout.projectDirectory.file("../package.json")).asText.map {
    requireNotNull(Regex(""""version"\s*:\s*"([^"]+)"""").find(it)).groupValues[1]
}
val androidVersion = providers.fileContents(rootProject.layout.projectDirectory.file("../app.config.ts")).asText.map {
    requireNotNull(Regex("ANDROID_VERSION_CODE = ([0-9]+)").find(it)).groupValues[1].toInt()
}
fun hostList(name: String): String {
    val hosts = providers.environmentVariable(name).orNull.orEmpty().split(",").map { it.trim().lowercase() }.filter { it.isNotEmpty() }
    require(hosts.all { it.matches(Regex("[a-z0-9.-]+")) }) { "Invalid hostname in $name" }
    return "\"" + hosts.distinct().joinToString(",") + "\""
}
android {
    buildFeatures { buildConfig = true }
    namespace = "ai.tokenroll.toolbridge.mobile"
    compileSdk = 36
    defaultConfig {
        applicationId = "ai.tokenroll.toolbridgemobile"
        buildConfigField("String", "MEDIA_HOSTS", hostList("EXPO_PUBLIC_MEDIA_HOSTS"))
        buildConfigField("String", "LINK_HOSTS", hostList("EXPO_PUBLIC_LINK_HOSTS"))
        minSdk = 24
        targetSdk = 36
        versionCode = androidVersion.get()
        versionName = mobileVersion.get()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes.create("local") {
        initWith(buildTypes.getByName("release"))
        applicationIdSuffix = ".local"
        signingConfig = signingConfigs.getByName("debug")
        isDebuggable = false
        matchingFallbacks += "release"
    }
    val releaseKeyFile = providers.environmentVariable("TB_ANDROID_KEYSTORE").orNull
    if (releaseKeyFile != null) {
        signingConfigs.create("projectRelease") {
            storeFile = file(releaseKeyFile)
            storePassword = providers.environmentVariable("TB_ANDROID_STORE_PASSWORD").get()
            keyAlias = providers.environmentVariable("TB_ANDROID_KEY_ALIAS").get()
            keyPassword = providers.environmentVariable("TB_ANDROID_KEY_PASSWORD").get()
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("projectRelease")
    }
    flavorDimensions += "distribution"
    productFlavors {
        create("development") { dimension = "distribution"; applicationIdSuffix = ".dev" }
        create("preview") { dimension = "distribution"; applicationIdSuffix = ".nativepreview" }
        create("production") { dimension = "distribution" }
    }
    packaging { resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*") }
    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation("com.networknt:json-schema-validator:1.5.9")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
