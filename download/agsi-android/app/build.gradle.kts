import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// =====================================================================
// Push FCM (Firebase Cloud Messaging) — plugin Google Services hanya
// diaktifkan bila file app/google-services.json tersedia. Tanpa file
// itu build tetap SUKSES; notifikasi push saja yang belum aktif.
// Panduan: README bagian "Notifikasi Push (FCM)".
// =====================================================================
val hasGoogleServices = file("google-services.json").exists()
if (hasGoogleServices) {
    apply(plugin = "com.google.gms.google-services")
}

// Signing release dibaca dari keystore.properties (gitignored).
// Tanpa file itu, hasil release berupa "-unsigned" (lihat README).
val keystoreProperties = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.agsi.app"
    compileSdk = 36

    defaultConfig {
        // ⚠ applicationId WAJIB sama dengan package_name di
        // app/google-services.json (registrasi Firebase project
        // agsi-pos-491c8) agar token FCM bisa diterbitkan.
        // namespace (paket kode Kotlin) tetap com.agsi.app.
        applicationId = "com.agsi.pos"
        minSdk = 26
        targetSdk = 36
        versionCode = 13
        versionName = "1.2.10"

        // URL website yang dibungkus — dari gradle.properties (WEB_APP_URL)
        val webAppUrl = (project.findProperty("WEB_APP_URL") as String?)
            ?: "https://agsi-v-2-0.vercel.app"
        buildConfigField("String", "AGSI_BASE_URL", "\"$webAppUrl\"")
    }

    signingConfigs {
        if (keystoreProperties.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // WebView wrapper — kode app sendiri sangat kecil; minify nonaktif
            // agar tidak ada risiko obfuscation pada bridge JS.
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (keystoreProperties.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

// Target JVM Kotlin (di luar blok android {})
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.material)
    implementation(libs.androidx.splashscreen)
    // Masuk biometrik: Face ID / sidik jari (layar buka kunci AppLock)
    implementation(libs.androidx.biometric)
    // FCM — dipakai hanya bila google-services.json tersedia (push notifikasi)
    implementation(libs.firebase.messaging)
}
