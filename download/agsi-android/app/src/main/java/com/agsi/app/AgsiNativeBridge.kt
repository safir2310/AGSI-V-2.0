package com.agsi.app

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * JEMBATAN JS `window.AgsiNative` — kontrak dengan:
 *  - src/lib/push-client.ts      → getFcmToken(), getAppVersion()
 *  - src/lib/biometric-client.ts → biometrik (Face ID / sidik jari) in-app
 *
 * Metode WAJIB:
 *   getFcmToken(): String — dipanggil PushBridge.tsx setelah pengguna login
 *   agar token terdaftar dengan sesi (platform "android", terikat role).
 *
 * Metode opsional:
 *   getAppVersion(): String
 *   isBiometricAvailable(): String  — "ok" | "not_enrolled" | "no_hardware"
 *   isBiometricEnabled(): Boolean   — status layar buka kunci biometrik
 *   enableBiometric(cbId: String)   — verifikasi biometrik lalu aktifkan;
 *                                     hasil dilempar ke window.__agsiNativeResult
 *   disableBiometric(): Boolean     — matikan layar buka kunci (true)
 *   saveFile(cbId, base64, fileName, mimeType) — simpan file dari web (struk
 *                                     HTML / laporan CSV) ke folder Unduhan;
 *                                     hasil via window.__agsiNativeResult
 *   printPage(cbId, title)          — buka dialog cetak sistem (PrintManager)
 *                                     di atas halaman web; hasil via callback
 *
 * Keamanan: bridge hanya dipasang pada WebView dengan allowlist domain AGSI
 * dan tidak mengekspos data rahasia. Metode biometrik hanya mengubah
 * preferensi perangkat — biometrik itu sendiri tak pernah keluar dari HP.
 */
class AgsiNativeBridge(
    private val appContext: Context,
    private val hostProvider: () -> MainActivity?,
) {

    @JavascriptInterface
    fun getFcmToken(): String = PushRegistrar.cachedToken(appContext)

    @JavascriptInterface
    fun getAppVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun isBiometricAvailable(): String =
        when (AppLock.availability(appContext)) {
            AppLock.Availability.OK -> "ok"
            AppLock.Availability.NOT_ENROLLED -> "not_enrolled"
            AppLock.Availability.NO_HARDWARE -> "no_hardware"
        }

    @JavascriptInterface
    fun isBiometricEnabled(): Boolean = AppLock.isEnabled(appContext)

    /**
     * Aktifkan layar buka kunci biometrik. Dialog verifikasi ditampilkan
     * dulu; hasil (sukses/gagal) dikirim balik lewat
     * `window.__agsiNativeResult(cbId, ok, message)` di WebView utama.
     */
    @JavascriptInterface
    fun enableBiometric(cbId: String) {
        val activity = hostProvider() ?: return resolve(cbId, false, "aplikasi tidak aktif")
        activity.main.post {
            activity.showBiometricEnableFlow(
                onSuccess = { resolve(cbId, true, "aktif") },
                onFailure = { reason -> resolve(cbId, false, reason) },
            )
        }
    }

    @JavascriptInterface
    fun disableBiometric(): Boolean {
        AppLock.setEnabled(appContext, false)
        return true
    }

    /**
     * Simpan file dari web (base64) ke folder Unduhan perangkat. WebView tidak
     * mendukung unduhan `blob:` — tombol "Simpan" struk & "Ekspor" laporan di
     * halaman admin memakai metode ini. Hasil dikirim balik via
     * `window.__agsiNativeResult(cbId, ok, message)`.
     */
    @JavascriptInterface
    fun saveFile(cbId: String, base64: String, fileName: String, mimeType: String) {
        val activity = hostProvider() ?: return resolve(cbId, false, "aplikasi tidak aktif")
        activity.main.post {
            activity.saveFileToDownloads(
                cbId,
                base64,
                fileName.ifBlank { "agsi-file" },
                mimeType.ifBlank { "application/octet-stream" },
            )
        }
    }

    /**
     * Buka dialog cetak sistem (PrintManager) untuk halaman web yang sedang
     * tampil — pengganti window.print() yang diabaikan WebView. Aturan
     * @media print halaman tetap berlaku, jadi hanya struk yang tercetak.
     */
    @JavascriptInterface
    fun printPage(cbId: String, title: String) {
        val activity = hostProvider() ?: return resolve(cbId, false, "aplikasi tidak aktif")
        activity.main.post { activity.printPage(cbId, title.ifBlank { "Struk AGSI" }) }
    }

    private fun resolve(cbId: String, ok: Boolean, message: String) {
        hostProvider()?.resolveBridge(cbId, ok, message)
    }
}
