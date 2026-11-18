package com.agsi.app

import android.content.Context
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.provider.Settings

/**
 * SUARA NOTIFIKASI YANG DAPAT DISESUAIKAN (v1.3.30 — permintaan pemilik).
 *
 * Pengguna memilih suara di halaman web: Profil ▸ Notifikasi Push ▸
 * "Suara Notifikasi". Pilihan disimpan PER PERANGKAT (SharedPreferences)
 * melalui jembatan AgsiNative.setNotificationSound().
 *
 * Android TIDAK mengizinkan kode mengubah suara channel yang sudah terpasang,
 * jadi setiap pilihan suara memakai CHANNEL VARIAannya sendiri:
 *   agsi_orders_v5_<key> / agsi_chat_v5_<key>
 * dibuat on-demand dengan properti persama v4 (IMPORTANCE_HIGH, getar kuat,
 * layar kunci penuh, badge) beda hanya SUARA. Semua penyaji kartu
 * (PushService FCM + NotifPollerService) memanggil channelFor(kind) sehingga
 * suara baru langsung berlaku untuk notifikasi berikutnya — walau aplikasi
 * ditutup / layar terkunci (channel dibaca saat kartu dibangun).
 *
 * Katalog (key = sinkron dengan PushSettingsSheet.tsx):
 *   chime  — AGSI Chime klasik (default, seperti v1.3.10)
 *   ding   — dering tunggal cerah
 *   bell   — bel ganda lembut
 *   marimba — aksen kayu hangat
 *   pop    — gelembung ramah singkat
 *   system — suara notifikasi SISTEM pilihan pengguna di pengaturan HP
 *   silent — tanpa suara (hanya getar)
 */
object NotifSound {

    private const val PREFS = "agsi_prefs"
    private const val PREF_KEY = "notif_sound"
    private const val BASE_ORDERS = "agsi_orders_v5_"
    private const val BASE_CHAT = "agsi_chat_v5_"

    /** Urutan tampil di halaman Profil — key HARUS sinkron dgn PushSettingsSheet.tsx */
    val KEYS = listOf("chime", "ding", "bell", "marimba", "pop", "system", "silent")

    fun isValid(key: String): Boolean = key in KEYS

    fun get(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(PREF_KEY, "chime")?.takeIf { isValid(it) } ?: "chime"

    /** Simpan pilihan + pastikan channel variasinya ada. true = sukses. */
    fun set(ctx: Context, key: String): Boolean {
        if (!isValid(key)) return false
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(PREF_KEY, key).apply()
        ensureChannels(ctx, key)
        return true
    }

    /**
     * Channel untuk kartu notifikasi berikutnya mengikuti preferensi suara.
     * Dipakai PushService (FCM) & NotifPollerService. kind "chat" → channel
     * chat; jenis lain (new_order/order_paid/order_status/courier_task) →
     * channel pesanan.
     */
    fun channelFor(ctx: Context, kind: String): String {
        val key = get(ctx)
        ensureChannels(ctx, key)
        return if (kind == "chat") BASE_CHAT + key else BASE_ORDERS + key
    }

    /** Sumber suara (Uri) untuk satu pilihan; null = senyap. */
    private fun soundUri(ctx: Context, key: String): Uri? = when (key) {
        "chime" -> Uri.parse("android.resource://${ctx.packageName}/raw/agsi_chime")
        "ding" -> Uri.parse("android.resource://${ctx.packageName}/raw/agsi_ding")
        "bell" -> Uri.parse("android.resource://${ctx.packageName}/raw/agsi_bell")
        "marimba" -> Uri.parse("android.resource://${ctx.packageName}/raw/agsi_marimba")
        "pop" -> Uri.parse("android.resource://${ctx.packageName}/raw/agsi_pop")
        "system" -> Settings.System.DEFAULT_NOTIFICATION_URI
        else -> null // silent
    }

    /** Label tampilan satu pilihan (dipakai nama channel & UI web via bridge). */
    fun label(ctx: Context, key: String): String = when (key) {
        "chime" -> ctx.getString(R.string.sound_chime_name)
        "ding" -> ctx.getString(R.string.sound_ding_name)
        "bell" -> ctx.getString(R.string.sound_bell_name)
        "marimba" -> ctx.getString(R.string.sound_marimba_name)
        "pop" -> ctx.getString(R.string.sound_pop_name)
        "system" -> ctx.getString(R.string.sound_system_name)
        else -> ctx.getString(R.string.sound_silent_name)
    }

    /** Daftar katalog utk UI web: [{"key","label"}]. */
    fun catalogJson(ctx: Context): String {
        val sb = StringBuilder("[")
        KEYS.forEachIndexed { i, k ->
            sb.append("{\"key\":\"").append(k).append("\",\"label\":\"")
                .append(label(ctx, k).replace("\"", "\\\"")).append("\"}")
            if (i < KEYS.size - 1) sb.append(",")
        }
        sb.append("]")
        return sb.toString()
    }

    /**
     * Buat (sekali) channel pesanan + chat utk satu pilihan suara — properti
     * identik dengan channel v4 di AgsiApp, beda hanya ID + SUARA. Senyap =
     * tanpa suara, getar TETAP menyala (pola kuat pesanan).
     */
    private fun ensureChannels(ctx: Context, key: String) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val audio = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val uri = soundUri(ctx, key)
        val soundLabel = label(ctx, key)

        val orders = NotificationChannel(
            BASE_ORDERS + key,
            ctx.getString(R.string.notification_channel_name) + " · " + soundLabel,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = ctx.getString(R.string.notification_channel_desc)
            setSound(uri, if (uri == null) null else audio)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 300, 120, 300, 120, 300)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(true)
        }
        nm.createNotificationChannel(orders)

        val chat = NotificationChannel(
            BASE_CHAT + key,
            ctx.getString(R.string.channel_chat_name) + " · " + soundLabel,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = ctx.getString(R.string.channel_chat_desc)
            setSound(uri, if (uri == null) null else audio)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 200, 120, 200)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(true)
        }
        nm.createNotificationChannel(chat)
    }

    /**
     * Pratinjau suara dari halaman Profil (tombol ▶). Memainkan WAV lewat
     * MediaPlayer di stream NOTIFIKASI — sama persis dengan yang terdengar
     * saat pesanan masuk. Aman dipanggil dari thread jembatan WebView.
     */
    fun preview(ctx: Context, key: String) {
        val uri = soundUri(ctx, key) ?: return // silent = tidak ada yang diputar
        try {
            val attr = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val mp = MediaPlayer()
            mp.setAudioAttributes(attr)
            mp.setDataSource(ctx, uri)
            mp.setOnCompletionListener { it.release() }
            mp.prepare()
            mp.start()
        } catch (_: Exception) {
            // perangkat sibuk / format tak didukung — pratinjau bukan hal fatal
        }
    }
}
