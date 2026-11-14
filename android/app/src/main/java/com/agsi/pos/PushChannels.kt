package com.agsi.pos

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.graphics.Color

/**
 * Channel notifikasi — kunci HEADS-UP:
 * IMPORTANCE_HIGH = banner melayang di atas layar + suara/vibrasi,
 * walau HP sedang dipakai. Channel berlaku sejak app pertama dibuka
 * (dipanggil dari MainActivity.onCreate & sebelum tiap notify).
 */
object PushChannels {
    const val ORDERS = "agsi_orders"
    /**
     * Channel keep-alive TERSEMBUNYI (v1.3.1+). ID BARU — bukan sekadar
     * mengubah importance "agsi_keepalive" lama, karena Android TIDAK
     * memperbolehkan kode menurunkan importance channel yang sudah ada
     * (importance channel lama dikunci setelah dibuat).
     */
    const val KEEPALIVE = "agsi_keepalive_hidden"
    /** Channel keep-alive lama (v1.1–v1.3.0, TERLIHAT) — dihapus saat migrasi */
    const val KEEPALIVE_LEGACY = "agsi_keepalive"

    fun create(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val orders = NotificationChannel(
            ORDERS,
            context.getString(R.string.channel_orders_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.channel_orders_desc)
            enableLights(true)
            lightColor = Color.parseColor("#EA580C")
            enableVibration(true)
        }
        nm.createNotificationChannel(orders)

        // Keep-alive: notifikasi foreground service DISEMBUNYIKAN.
        // IMPORTANCE_NONE → notifikasi TIDAK PERNAH tampil di status bar /
        // lock screen, tetapi layanan tetap sah sebagai foreground service
        // (proses tetap hidup → FCM pesanan & chat tetap masuk seketika).
        // Trik standar aplikasi pesan-antar: notifikasi "aktif di latar
        // belakang" hanya mengganggu, kehadirannya tidak diperlukan user.
        val keepalive = NotificationChannel(
            KEEPALIVE,
            context.getString(R.string.channel_keepalive_name),
            NotificationManager.IMPORTANCE_NONE
        ).apply {
            description = context.getString(R.string.channel_keepalive_desc)
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
            setBlockable(true)
        }
        nm.createNotificationChannel(keepalive)

        // Perangkat yang memakai versi lama masih punya channel
        // "agsi_keepalive" IMPORTANCE_MIN yang TERLIHAT (bisa dibuka user
        // dari pengaturan) — hapus supaya bersih; dibuat ulang dalam
        // bentuk tersembunyi di atas.
        nm.deleteNotificationChannel(KEEPALIVE_LEGACY)
    }
}
