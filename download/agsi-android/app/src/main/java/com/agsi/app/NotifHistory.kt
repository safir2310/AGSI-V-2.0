package com.agsi.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * NotifHistory — RIWAYAT SEMUA NOTIFIKASI untuk PUSAT NOTIFIKASI (v1.3.10).
 *
 * Setiap notifikasi (kartu sistem saat aplikasi ditutup MAUPUN pemberitahuan
 * real-time saat aplikasi terbuka) direkam di sini sebagai daftar JSON di
 * SharedPreferences (terbaru di akhir, maksimal 60 entri). Halaman web
 * "Pusat Notifikasi" membacanya lewat jembatan AgsiNative.getNotifHistory()
 * dan mengosongkannya lewat clearNotifHistory().
 *
 * Entri: { ts, kind, tag, title, body, url } — ts = waktu kejadian (ms),
 * kind = jenis push (new_order/order_paid/order_status/chat/courier_task),
 * url = tujuan deep link ketika entri diketuk.
 */
object NotifHistory {

    private const val PREFS = "agsi_notif_history"
    private const val KEY = "entries"
    private const val CAP = 60

    fun add(ctx: Context, kind: String, tag: String, title: String, body: String, url: String) {
        if (title.isBlank() && body.isBlank()) return
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return try {
            val arr = JSONArray(prefs.getString(KEY, "[]") ?: "[]")
            val entry = JSONObject()
                .put("ts", System.currentTimeMillis())
                .put("kind", kind)
                .put("tag", tag)
                .put("title", title)
                .put("body", body)
                .put("url", url)
            arr.put(entry)
            while (arr.length() > CAP) arr.remove(0)
            prefs.edit().putString(KEY, arr.toString()).apply()
        } catch (_: Exception) {
            // riwayat rusak → mulai baru, jangan ganggu notifikasi utama
            prefs.edit().putString(KEY, JSONArray().toString()).apply()
        }
    }

    /** Seluruh riwayat sebagai string JSON array (untuk jembatan web). */
    fun read(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, "[]") ?: "[]"

    fun clear(ctx: Context): Boolean {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY).apply()
        return true
    }
}
