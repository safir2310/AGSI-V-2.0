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

    private fun resolve(cbId: String, ok: Boolean, message: String) {
        val payload = JSONObject().apply {
            put("id", cbId)
            put("ok", ok)
            put("message", message)
        }
        val script = "window.__agsiNativeResult && window.__agsiNativeResult(${payload})"
        val wv: WebView? = hostProvider()?.peekWebView()
        wv?.post { wv.evaluateJavascript(script, null) }
    }
}
