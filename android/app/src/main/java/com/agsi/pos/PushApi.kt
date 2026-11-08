package com.agsi.pos

import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Pendaftaran token FCM ke server AGSI: POST {WEB_APP_URL}/api/push/register
 * { token, platform: "android" }.
 *
 * Dipanggil dari background thread (token baru / app dibuka). Tanpa cookie
 * sesi → token tersimpan ANONIM; begitu pengguna masuk di WebView,
 * PushBridge memanggil ulang endpoint yang sama lewat jembatan AgsiNative
 * sehingga token terikat ke akun & role (target push per peran).
 */
object PushApi {
    private const val TAG = "AGSIPush"

    fun registerAsync(token: String) {
        Thread {
            try {
                val base = BuildConfig.WEB_APP_URL.trimEnd('/')
                val conn = URL("$base/api/push/register").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("User-Agent", "AGSIAndroidApp/${BuildConfig.VERSION_NAME}")
                conn.outputStream.use { it.write(JSONObject().apply {
                    put("token", token)
                    put("platform", "android")
                }.toString().toByteArray()) }
                Log.i(TAG, "Token terdaftar ke server (HTTP ${conn.responseCode})")
                conn.disconnect()
            } catch (e: Exception) {
                Log.w(TAG, "Pendaftaran token gagal (dicoba ulang saat token berubah / app dibuka): ${e.message}")
            }
        }.start()
    }
}
