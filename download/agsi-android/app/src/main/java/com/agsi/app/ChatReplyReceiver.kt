package com.agsi.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.webkit.CookieManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * ChatReplyReceiver — QUICK REPLY: balas chat LANGSUNG dari notifikasi
 * (v1.3.10, fitur notifikasi #7). Tombol "Balas" pada notifikasi chat
 * (RemoteInput, dibangun AgsiNotifications.replyAction) mengirim teks ke
 * sini; receiver memanggil POST /api/chat dengan cookie sesi web:
 *
 *  - Pelanggan / kasir : POST {body} → masuk utas chat sendiri.
 *  - Admin / owner     : GET /api/chat → utas pelanggan dengan pesan belum
 *    dibaca terbaru (fallback: utas terbaru) → POST {body, userId}.
 *
 * Sukses: notifikasi chat dibersihkan + kartu senyap "✓ Balasan terkirim"
 * (hilang sendiri ±4 detik). Gagal: kartu "Gagal membalas" — tap membuka
 * menu Chat. Server juga mengirim push FCM ke lawan bicara (after() di
 * route chat), jadi pihak lain tetap mendapat kabar real-time.
 */
class ChatReplyReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_REPLY = "com.agsi.app.ACTION_REPLY"
        const val EXTRA_TAG = "tag"
        const val EXTRA_ID = "id"

        private const val TAG = "AGSI/Reply"
        private const val SESSION_PREFIX = "agsi_session="
        /** Satu pekerja jaringan — balasan diproses berurutan. */
        private val executor = Executors.newSingleThreadExecutor()
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_REPLY) return
        val remote = RemoteInput.getResultsFromIntent(intent) ?: return
        val text = remote.getCharSequence(AgsiNotifications.REPLY_RESULT_KEY)
            ?.toString()?.trim()?.take(500) ?: return
        if (text.isEmpty()) return
        val tag = intent.getStringExtra(EXTRA_TAG) ?: "chat"
        val id = intent.getIntExtra(EXTRA_ID, "chat".hashCode())

        val pending = goAsync() // beri waktu permintaan jaringan (max ~10 dtk)
        executor.execute {
            try {
                sendReply(context, tag, id, text)
            } catch (e: Exception) {
                android.util.Log.w(TAG, "Balasan cepat gagal", e)
                AgsiNotifications.showReplyConfirmation(context, text, ok = false)
            } finally {
                pending.finish()
            }
        }
    }

    private fun sendReply(context: Context, tag: String, id: Int, text: String) {
        val cookie = CookieManager.getInstance().getCookie(SiteConfig.BASE_URL + "/") ?: ""
        if (!hasSession(cookie)) {
            AgsiNotifications.showReplyConfirmation(context, text, ok = false)
            return
        }

        // Peran pengguna menentukan bentuk POST (lihat src/app/api/chat/route.ts)
        var staff = false
        val (_, me) = getJson("/api/auth/me", cookie)
        val role = me?.optJSONObject("user")?.optString("role", "") ?: ""
        if (role == "ADMIN" || role == "OWNER" || role == "CASHIER") staff = true

        var ok = false
        if (staff) {
            // Pilih utas pelanggan: yang punya pesan belum dibaca (terbaru dulu),
            // kalau semua sudah dibaca pakai utas paling baru.
            val (_, threadsJson) = getJson("/api/chat", cookie)
            val threads = threadsJson?.optJSONArray("threads")
            var userId = ""
            if (threads != null) {
                for (i in 0 until threads.length()) {
                    val t = threads.optJSONObject(i) ?: continue
                    if (t.optInt("unreadAdmin", 0) > 0) {
                        userId = t.optString("userId", "")
                        break
                    }
                }
                if (userId.isBlank() && threads.length() > 0) {
                    userId = threads.optJSONObject(0)?.optString("userId", "") ?: ""
                }
            }
            if (userId.isNotBlank()) {
                val (code, _) = postJson(
                    "/api/chat",
                    JSONObject().put("body", text).put("userId", userId),
                    cookie,
                )
                ok = code in 200..299
            }
        } else {
            val (code, _) = postJson("/api/chat", JSONObject().put("body", text), cookie)
            ok = code in 200..299
        }

        if (ok) {
            // Bersihkan notifikasi chat yang dibalas + konfirmasi senyap singkat
            try {
                NotificationManagerCompat.from(context).cancel(tag, id)
            } catch (_: Exception) {
            }
            AgsiNotifications.showReplyConfirmation(context, text, ok = true)
        } else {
            AgsiNotifications.showReplyConfirmation(context, text, ok = false)
        }
    }

    // ==================== Util HTTP ====================

    private fun hasSession(cookie: String): Boolean =
        cookie.split(";").any {
            it.trim().startsWith(SESSION_PREFIX) && it.trim().length > SESSION_PREFIX.length
        }

    private fun request(
        path: String,
        method: String,
        body: JSONObject?,
        cookie: String,
    ): Pair<Int, JSONObject?> {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("${SiteConfig.BASE_URL}$path").openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 12_000
                readTimeout = 12_000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "AGSIAndroidApp/${BuildConfig.VERSION_NAME} (quick-reply)")
                if (cookie.isNotBlank()) setRequestProperty("Cookie", cookie)
                if (body != null) {
                    setRequestProperty("Content-Type", "application/json")
                    doOutput = true
                    outputStream.use { it.write(body.toString().toByteArray()) }
                }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            Pair(code, if (text.startsWith("{")) JSONObject(text) else null)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "Permintaan $path gagal: ${e.message}")
            Pair(0, null)
        } finally {
            conn?.disconnect()
        }
    }

    private fun getJson(path: String, cookie: String): Pair<Int, JSONObject?> =
        request(path, "GET", null, cookie)

    private fun postJson(path: String, body: JSONObject, cookie: String): Pair<Int, JSONObject?> =
        request(path, "POST", body, cookie)
}
