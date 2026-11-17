package com.agsi.app

import android.content.Context
import android.os.PowerManager
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
 *   openBiometricEnroll(): Boolean  — buka layar pendaftaran biometrik di
 *                                     Pengaturan HP (wajah/sidik jari belum
 *                                     terdaftar); true = pengaturan dibuka
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

    /** v1.3.21 — true bila Firebase ter-inisialisasi di APK ini (google-services
     *  .json ada saat build). false = APK dibangun TANPA kredensial Firebase →
     *  token FCM tidak akan PERNAH ada; halaman menampilkan petunjuk update
     *  alih-alih "tunggu beberapa detik" yang sia-sia. */
    @JavascriptInterface
    fun isPushAvailable(): Boolean = try {
        com.google.firebase.FirebaseApp.getApps(appContext).isNotEmpty()
    } catch (e: Throwable) {
        false
    }

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
     * Buka layar pendaftaran biometrik sistem (Pengaturan HP) — dipakai panel
     * Login Biometrik saat perangkat belum punya wajah/sidik jari terdaftar,
     * sehingga pengguna tidak perlu mencari menu pengaturan secara manual.
     * Android tidak mengizinkan pendaftaran biometrik langsung dari aplikasi,
     * jadi ini pintu tercepat yang sah. Return false bila aplikasi tidak aktif.
     */
    @JavascriptInterface
    fun openBiometricEnroll(): Boolean {
        val activity = hostProvider() ?: return false
        activity.main.post { activity.openBiometricEnrollSettings() }
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
     * BAGIKAN file dari web (v1.3.27) lewat lembar bagikan Android — fallback
     * ANTI-GAGAL untuk saveFile: file ditulis ke cache aplikasi lalu
     * ACTION_SEND (FileProvider), tanpa menyentuh penyimpanan Unduhan. Hasil
     * via `window.__agsiNativeResult(cbId, ok, message)`.
     */
    @JavascriptInterface
    fun shareFile(cbId: String, base64: String, fileName: String, mimeType: String) {
        val activity = hostProvider() ?: return resolve(cbId, false, "aplikasi tidak aktif")
        activity.main.post {
            activity.shareFileFromCache(
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

    /**
     * Saklar NOTIFIKASI LATAR BELAKANG dari halaman web (Profil → Notifikasi
     * Push). true = layanan pemantau (NotifPollerService) berjalan sehingga
     * notifikasi pesanan/chat tetap muncul walau aplikasi ditutup.
     */
    @JavascriptInterface
    fun setNotifPolling(enabled: Boolean): Boolean {
        NotifPollerService.setEnabled(appContext, enabled)
        return true
    }

    /** Status saklar notifikasi latar belakang (default: aktif). */
    @JavascriptInterface
    fun isNotifPollingEnabled(): Boolean = NotifPollerService.isEnabled(appContext)

    /**
     * IZIN BERJALAN DI LATAR BELAKANG (v1.3.12): true bila AGSI sudah
     * dikecualikan dari optimasi baterai (dialog sistem "izinkan AGSI
     * mengabaikan optimasi baterai" pernah disetujui). Dipakai baris status
     * "Berjalan di Latar Belakang" di Pengaturan Notifikasi (web).
     */
    @JavascriptInterface
    fun isBatteryUnrestricted(): Boolean {
        val pm = appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(appContext.packageName)
    }

    /**
     * Tombol "Izinkan Baterai" di Pengaturan Notifikasi → dialog sistem
     * langsung TANPA jeda (permintaan otomatis saat aplikasi dibuka berjeda
     * 3 hari). Return false bila aplikasi tidak aktif.
     */
    @JavascriptInterface
    fun requestBatteryUnrestriction(): Boolean {
        val activity = hostProvider() ?: return false
        activity.main.post { activity.openBatteryExemptionRequest() }
        return true
    }

    /**
     * Tombol "Autostart" di Pengaturan Notifikasi → layar Autostart milik
     * pabrikan (Xiaomi MIUI, OPPO/realme, vivo, Huawei/Honor) — di HP
     * tersebut sistem mematikan layanan notifikasi AGSI saat aplikasi
     * ditutup sampai Autostart diaktifkan, walau baterai sudah dikecualikan.
     * Pabrikan lain → layar detail aplikasi. Return false bila tidak aktif.
     */
    @JavascriptInterface
    fun openAutostartSettings(): Boolean {
        val activity = hostProvider() ?: return false
        activity.main.post { activity.openAutostartSettings() }
        return true
    }

    /**
     * PUSAT NOTIFIKASI (v1.3.10): seluruh riwayat notifikasi sebagai JSON
     * array [{ts, kind, tag, title, body, url}] — kartu sistem saat aplikasi
     * ditutup (PushService/NotifPollerService) + kabar real-time saat
     * aplikasi terbuka (forwardToPage). Terbaru di AKHIR array.
     */
    @JavascriptInterface
    fun getNotifHistory(): String = NotifHistory.read(appContext)

    /** Kosongkan riwayat pusat notifikasi (tombol "Kosongkan" di halaman). */
    @JavascriptInterface
    fun clearNotifHistory(): Boolean = NotifHistory.clear(appContext)

    private fun resolve(cbId: String, ok: Boolean, message: String) {
        hostProvider()?.resolveBridge(cbId, ok, message)
    }
}
