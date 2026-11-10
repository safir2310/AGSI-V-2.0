package com.agsi.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Manajemen token FCM: simpan ke SharedPreferences lalu daftarkan ke backend:
 *   POST /api/push/register  { "token": "...", "platform": "android" }
 *
 * Kontrak dengan halaman web (src/lib/push-client.ts):
 *  - Sebelum login, aplikasi mendaftarkan token ANONIM (platform "android").
 *  - Setelah pengguna masuk, halaman memanggil AgsiNative.getFcmToken()
 *    (jembatan JS) dan mendaftarkan ulang token dengan sesi login sehingga
 *    token terikat userId & role — target push per peran jadi akurat.
 */
object PushRegistrar {

    private const val TAG = "AGSI/Push"
    private const val PREFS = "agsi_push"
    private const val KEY_TOKEN = "fcm_token"
    private const val KEY_REGISTERED = "fcm_registered"

    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Token ter-cache — dibaca AgsiNativeBridge.getFcmToken() dari JS. */
    fun cachedToken(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TOKEN, "") ?: ""

    /** Ambil token dari SDK FCM lalu simpan + daftarkan bila berubah. */
    fun syncRegistration(ctx: Context) {
        executor.execute {
            val appCtx = ctx.applicationContext
            val token = try {
                Tasks.await(FirebaseMessaging.getInstance().token)
            } catch (e: Exception) {
                Log.i(TAG, "FCM belum tersedia (google-services.json belum ada?) — push dilewati")
                return@execute
            }
            if (token.isBlank()) return@execute
            val prefs = appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val unchanged = prefs.getString(KEY_TOKEN, "") == token &&
                prefs.getBoolean(KEY_REGISTERED, false)
            prefs.edit().putString(KEY_TOKEN, token).apply()
            if (!unchanged) postRegister(appCtx, token)
        }
    }

    /** Dipanggil PushService.onNewToken — simpan token baru lalu daftarkan. */
    fun storeAndRegister(ctx: Context, token: String) {
        val appCtx = ctx.applicationContext
        appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_TOKEN, token)
            .putBoolean(KEY_REGISTERED, false)
            .apply()
        executor.execute { postRegister(appCtx, token) }
    }

    /** Dipanggil saat app dibuka — beri jeda agar proses siap penuh. */
    fun fetchAndRegisterLater(ctx: Context) {
        mainHandler.postDelayed({ syncRegistration(ctx) }, 2500)
    }

    /** POST /api/push/register dengan retry sederhana. Thread background. */
    private fun postRegister(ctx: Context, token: String): Boolean {
        repeat(2) { attempt ->
            try {
                val conn = (URL("${SiteConfig.BASE_URL}/api/push/register").openConnection()
                        as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 15_000
                    readTimeout = 15_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty(
                        "User-Agent",
                        "AGSIAndroidApp/${BuildConfig.VERSION_NAME} (push-register)"
                    )
                    CookieManager.getInstance().getCookie(SiteConfig.BASE_URL)?.let {
                        setRequestProperty("Cookie", it)
                    }
                }
                val payload =
                    "{\"token\":${jsonString(token)},\"platform\":\"android\"}"
                conn.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                conn.disconnect()
                if (code in 200..299) {
                    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .edit().putBoolean(KEY_REGISTERED, true).apply()
                    Log.i(TAG, "Token push terdaftar ke server (HTTP $code)")
                    return true
                }
                Log.w(TAG, "Registrasi push gagal HTTP $code (percobaan ${attempt + 1})")
            } catch (e: Exception) {
                Log.w(TAG, "Registrasi push gagal (percobaan ${attempt + 1})", e)
            }
            try {
                Thread.sleep(3000)
            } catch (_: InterruptedException) {
                return false
            }
        }
        return false
    }

    private fun jsonString(raw: String): String =
        "\"" + raw.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}
