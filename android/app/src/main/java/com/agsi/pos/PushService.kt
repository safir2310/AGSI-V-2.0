package com.agsi.pos

import android.app.PendingIntent
import android.content.Intent
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Penerima pesan FCM — menampilkan HEADS-UP notification.
 *
 * - App di BACKGROUND: notifikasi `notification` payload ditampilkan sistem
 *   otomatis pada channel agsi_orders (IMPORTANCE_HIGH → banner heads-up).
 * - App di FOREGROUND (layar terbuka): onMessageReceived dipanggil —
 *   notifikasi dibangun di sini dengan prioritas MAX.
 * - Token baru (instal ulang, app dihapus, dsb.) → didaftarkan ulang ke server.
 */
class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        FcmTokenHolder.token = token
        PushApi.registerAsync(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification
        val data = message.data
        val title = n?.title ?: data["title"] ?: "AGSI — Ayam Geprek Sambal Ijo"
        val body = n?.body ?: data["body"] ?: ""
        val url = data["url"] ?: "/"
        val tag = data["tag"] ?: "agsi"
        showHeadsUp(title, body, url, tag)
    }

    private fun showHeadsUp(title: String, body: String, url: String, tag: String) {
        PushChannels.create(this)

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_URL, url)
        }
        val pending = PendingIntent.getActivity(
            this,
            url.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, PushChannels.ORDERS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
            .setVibrate(longArrayOf(120, 60, 120))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        getSystemService(android.app.NotificationManager::class.java)
            .notify(tag, System.currentTimeMillis().toInt(), notification)
    }
}
