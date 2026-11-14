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
 * Layanan FCM — menerima push dari backend (src/lib/push.ts + src/lib/fcm.ts).
 *
 * - Aplikasi di BACKGROUND: SDK FCM menampilkan notifikasi otomatis dengan
 *   channel default (meta-data di AndroidManifest) — tap membuka MainActivity.
 *   Chat memakai channel "agsi_chat" (channel_id dari payload server).
 * - Aplikasi di FOREGROUND: push DITERUSKAN KE HALAMAN WEB lewat broadcast →
 *   event JS "agsi-push" — popup + suara + daftar pesanan/chat di halaman
 *   menyala INSTAN (real-time), tanpa notifikasi sistem ganda.
 * - data.url berisi path tujuan setelah banner diketuk (mis. "/orders").
 */
class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        PushRegistrar.storeAndRegister(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val kind = data["kind"] ?: ""
        val title = message.notification?.title ?: data["title"] ?: return
        val body = message.notification?.body ?: data["body"] ?: ""
        val url = data["url"] ?: "/"
        val tag = data["tag"] ?: "agsi"
        val orderId = data["orderId"]
        // Pesanan sama saling mengganti, bukan menumpuk (sinkron data.tag server)
        val id = (orderId ?: title).hashCode()

        // ===== Aplikasi TERBUKA: real-time ke halaman, tanpa notifikasi ganda
        if (AgsiApp.isForeground) {
            forwardToPage(kind, title, body, url, orderId, tag)
            return
        }

        // ===== Aplikasi di latar belakang: heads-up notifikasi sistem
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

        // Chat CS tampil di channel sendiri agar bisa diatur terpisah
        val channel = if (kind == "chat") AgsiApp.CHANNEL_CHAT else AgsiApp.CHANNEL_ORDERS

        val notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // 🔒 Tampil PENUH di layar kunci (detail pesanan terbaca langsung)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // ⏰ HP tidur/terkunci → layar DIBANGUNKAN & aplikasi tampil langsung
            // di atas layar kunci (full-screen intent). Saat layar nyala & tidak
            // terkunci, Android tetap memakai heads-up banner biasa.
            .setFullScreenIntent(pending, true)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        try {
            NotificationManagerCompat.from(this).notify(tag, id, notification)
        } catch (_: SecurityException) {
            // izin notifikasi dicabut pengguna — abaikan
        }
    }

    /** Teruskan push ke halaman web (saat aplikasi terbuka): broadcast →
     *  MainActivity → event JS "agsi-push" → popup + suara + refresh instan.
     *  Detail event dipakai watcher web (src/components/shared/NotifWatchers.tsx). */
    private fun forwardToPage(
        kind: String,
        title: String,
        body: String,
        url: String,
        orderId: String?,
        tag: String,
    ) {
        val payload = org.json.JSONObject().apply {
            put("kind", kind)
            put("title", title)
            put("body", body)
            put("url", url)
            put("tag", tag)
            if (orderId != null) put("orderId", orderId)
        }
        try {
            sendBroadcast(
                Intent(MainActivity.ACTION_PUSH_RECEIVED)
                    .setPackage(packageName)
                    .putExtra("payload", payload.toString())
            )
        } catch (e: Exception) {
            android.util.Log.w("AGSI/Push", "Gagal meneruskan push ke halaman", e)
        }
    }
}
