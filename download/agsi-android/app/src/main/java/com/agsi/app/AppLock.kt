package com.agsi.app

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * APP LOCK BIOMETRIK — "masuk pakai Face ID / sidik jari" di aplikasi AGSI.
 *
 * Cara kerja (kontrak dengan src/lib/biometric-client.ts + BiometricSheet.tsx):
 *  - Ketika sesi login tersimpan (cookie `agsi_session`) dan fitur diaktifkan,
 *    setiap aplikasi DIBUKA akan muncul layar buka kunci native dengan
 *    BiometricPrompt: pemindaian sidik jari / wajah sesuai sensor perangkat.
 *  - Kunci perangkat (device credential) tetap opsional; fitur hanya aktif
 *    bila hardware biometrik terdeteksi & sudah terdaftar di layar kunci HP.
 *  - Preferensi disimpan di SharedPreferences (per perangkat, bukan di web).
 *
 * Keamanan:
 *  - Biometrik TIDAK PERNAH keluar dari perangkat — BiometricPrompt hanya
 *    mengembalikan sukses/gagal (perangkat memverifikasi langsung di TEE).
 *  - Gagal/cabut → pengguna bisa pilih "Masuk dengan kata sandi": sesi
 *    cookie dibersihkan lalu halaman login web ditampilkan.
 */
object AppLock {

    private const val PREFS = "agsi_app_lock"
    private const val KEY_ENABLED = "biometric_enabled"
    private const val KEY_DECLINED = "biometric_declined"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENABLED, value).apply()
        if (value) setDeclined(context, false)
    }

    /** Pengguna pernah menolak tawaran aktivasi — jangan tawarkan lagi. */
    fun hasDeclined(context: Context): Boolean =
        prefs(context).getBoolean(KEY_DECLINED, false)

    fun setDeclined(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_DECLINED, value).apply()
    }

    enum class Availability { OK, NOT_ENROLLED, NO_HARDWARE }

    /** Cek kesiapan sensor biometrik perangkat (sidik jari / wajah). */
    fun availability(context: Context): Availability {
        val manager = BiometricManager.from(context)
        val res = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
        return when (res) {
            BiometricManager.BIOMETRIC_SUCCESS -> Availability.OK
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> Availability.NOT_ENROLLED
            else -> Availability.NO_HARDWARE
        }
    }

    /** true bila layar buka kunci layak ditampilkan saat aplikasi dibuka. */
    fun shouldGate(context: Context, hasSession: Boolean): Boolean =
        hasSession && isEnabled(context) && availability(context) == Availability.OK

    /**
     * Tampilkan dialog verifikasi biometrik. [onResult] dipanggil tepat satu
     * kali: [success] = terverifikasi, [errorCode] = kode BiometricPrompt
     * (ERROR_NEGATIVE_BUTTON berarti pengguna menekan tombol negatif).
     */
    fun authenticate(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        negativeText: String,
        onResult: (success: Boolean, errorCode: Int) -> Unit,
    ) {
        if (availability(activity) != Availability.OK) {
            onResult(false, BiometricPrompt.ERROR_NO_BIOMETRICS)
            return
        }
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                private var delivered = false

                private fun once(result: Boolean, code: Int) {
                    if (delivered) return
                    delivered = true
                    onResult(result, code)
                }

                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    once(true, 0)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    once(false, errorCode)
                }

                override fun onAuthenticationFailed() {
                    // Percobaan tak terbaca — BiometricPrompt masih aktif,
                    // biarkan pengguna mencoba lagi di dialog yang sama.
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButtonText(negativeText)
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
            .build()
        prompt.authenticate(info)
    }
}
