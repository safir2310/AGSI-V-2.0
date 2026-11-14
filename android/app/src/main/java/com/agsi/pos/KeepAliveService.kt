package com.agsi.pos

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * LAYANAN LATAR BELAKANG AGSI (foreground service, START_STICKY).
 *
 * Tujuan: memenuhi permintaan "aplikasi tetap berjalan di latar belakang
 * agar pesanan masuk langsung ternotifikasi". Proses aplikasi yang tetap
 * hidup membuat pengiriman FCM sampai SEKETIKA — beberapa HP (Xiaomi,
 * OPPO, Vivo, Samsung dengan penghemat baterai agresif) menunda/membuang
 * pesan FCM saat proses aplikasi dibunuh setelah di-swipe.
 *
 * Cara kerja:
 *  - Dimulai dari MainActivity.onCreate (app di depan → legal di Android 12+).
 *  - Menampilkan notifikasi TETAP "AGSI aktif di latar belakang" pada
 *    channel agsi_keepalive (IMPORTANCE_MIN — tanpa suara, tidak mengganggu).
 *  - START_STICKY: sistem menghidupkan ulang bila proses dibunuh sistem.
 *  - Tanpa loop jaringan — hemat baterai; FCM tetap lewat Google Play
 *    services, layanan ini hanya menjaga proses tetap hidup.
 *
 * Tipe foregroundServiceType="specialUse" (wajib targetSdk 35) — dipilih
 * karena layanan berjalan sepanjang jam operasional (tipe dataSync dibatasi
 * 6 jam/hari di Android 15); subtype dideklarasikan di AndroidManifest.xml.
 */
class KeepAliveService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        PushChannels.create(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())
        // START_STICKY = dihidupkan ulang otomatis bila sistem mematikan proses
        return START_STICKY
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, PushChannels.KEEPALIVE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.keepalive_title))
            .setContentText(getString(R.string.keepalive_body))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setShowWhen(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    companion object {
        private const val NOTIF_ID = 42

        /** Mulai layanan (aman dipanggil berulang — onStartCommand idempoten). */
        fun start(context: Context) {
            val intent = Intent(context, KeepAliveService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
