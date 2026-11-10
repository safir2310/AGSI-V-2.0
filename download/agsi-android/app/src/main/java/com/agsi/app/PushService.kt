package com.agsi.app

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Layanan FCM — menerima push dari backend (src/lib/push.ts + src/lib/fcm.ts)
 * dan menampilkan heads-up notification di channel "agsi_orders".
 *
 * - Aplikasi di BACKGROUND: SDK FCM menampilkan notifikasi otomatis dengan
 *   channel default (meta-data di AndroidManifest) — tap membuka MainActivity.
 * - Aplikasi di FOREGROUND: onMessageReceived dipanggil → notifikasi lokal
 *   channel yang sama.
 * - data.url berisi path tujuan setelah banner diketuk (mis. "/orders").
 */
class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        PushRegistrar.storeAndRegister(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = message.notification?.title ?: data["title"] ?: return
        val body = message.notification?.body ?: data["body"] ?: ""
        val url = data["url"] ?: "/"
        val tag = data["tag"] ?: "agsi"
        // Pesanan sama saling mengganti, bukan menumpuk (sinkron data.tag server)
        val id = (data["orderId"] ?: title).hashCode()

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
            putExtra(MainActivity.EXTRA_NAV_URL, url)
        }
        val pending = PendingIntent.getActivity(
            this,
            url.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, AgsiApp.CHANNEL_ORDERS)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        try {
            NotificationManagerCompat.from(this).notify(tag, id, notification)
        } catch (_: SecurityException) {
            // izin notifikasi dicabut pengguna — abaikan
        }
    }
}
