// Root build — deklarasi plugin untuk seluruh proyek.
// Versi selalu dirujuk dari gradle/libs.versions.toml (version catalog).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    // Plugin Google Services HANYA dipakai bila app/google-services.json ada
    // (lihat app/build.gradle.kts + README bagian "Notifikasi Push FCM").
    alias(libs.plugins.google.services) apply false
}
