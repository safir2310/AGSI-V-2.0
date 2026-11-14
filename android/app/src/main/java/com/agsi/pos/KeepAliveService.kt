package com.agsi.pos

import android.app.AlarmManager
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
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
 *  - onTaskRemoved: app DI-SWIPE dari recent → layanan dijadwalkan ulang
 *    lewat AlarmManager 1,5 detik kemudian, jadi notifikasi pesanan baru
 *    TETAP masuk walau pengguna "menutup aplikasi" (permintaan pemilik:
 *    aplikasi ditutup → notifikasi tetap berjalan dan masuk).
 *  - BootReceiver menghidupkan ulang setelah HP reboot / APK diperbarui.
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

    /**
     * App di-SWIPE dari recent apps → jadwalkan restart diri 1,5 detik
     * lagi lewat AlarmManager. Beberapa OEM membunuh layanan saat swipe
     * (bukan cuma activity); alarm memastikan proses hidup kembali
     * sehingga notifikasi pesanan baru tetap masuk.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val restart = Intent(applicationContext, KeepAliveService::class.java)
        val pending = PendingIntent.getService(
            this,
            1,
            restart,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.set(
            AlarmManager.ELAPSED_REALTIME,
            SystemClock.elapsedRealtime() + 1500,
            pending
        )
        super.onTaskRemoved(rootIntent)
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
            try {
                val intent = Intent(context, KeepAliveService::class.java)
                ContextCompat.startForegroundService(context, intent)
            } catch (e: Exception) {
                // Mis. device restore/kondisi aneh — jangan crash app;
                // layanan dicoba lagi saat app dibuka / boot berikutnya.
                Log.w("AGSIPush", "KeepAliveService gagal dimulai: ${e.message}")
            }
        }
    }
}
