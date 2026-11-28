package com.agsi.app

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Layanan FCM — menerima push dari backend (src/lib/push.ts + src/lib/fcm.ts).
 *
 * v1.3.11: server mengirim pesan DATA-ONLY (tanpa blok "notification") —
 * SEMUA push diproses lewat onMessageReceived, sehingga kartu notifikasi
 * seragam dari AgsiNotifications: STATUS BAR + LAYAR KUNCI PENUH + SUARA
 * KHAS AGSI + getar + heads-up + full-screen intent (membangunkan layar
 * tidur) tampil BERSAMAAN saat aplikasi ditutup. Sebelumnya, push saat app
 * ditutup ditampilkan otomatis SDK FCM TANPA full-screen intent (layar
 * tidak ikut menyala) dan tanpa grouping/quick reply.
 *
 * - Aplikasi di BACKGROUND (atau layar terkunci): kartu PENUH + suara.
 * - Aplikasi di FOREGROUND (v1.3.14 — permintaan pemilik: notifikasi muncul
 *   di STATUS BAR, bukan di dalam aplikasi): kartu PENUH + suara (sama
 *   dengan background) + push diteruskan ke halaman web lewat broadcast →
 *   event JS "agsi-push" (hanya segarkan data — tampilan web dimatikan).
 * - data.url berisi path tujuan setelah kartu diketuk (mis. "/orders").
 *
 * KONTROL NOTIFIKASI SENYAP (v1.3.8):
 *  - judul & isi kosong → tanpa notifikasi + sisa notifikasi kosong dihapus
 *    dari NotificationManager;
 *  - hanya jenis penting (SYSTEM_NOTIF_KINDS) yang jadi notifikasi sistem;
 *  - jenis "test" tidak pernah tampil sebagai notifikasi sistem.
 *
 * v1.3.10 — 10 FITUR NOTIFIKASI: kartu dibangun lewat AgsiNotifications
 * (grouping + ringkasan, quick reply chat, deep link, badge angka, suara
 * khas AGSI, rekam Pusat Notifikasi).
 */
/** Jenis push yang BOLEH tampil sebagai notifikasi sistem (v1.3.8 —
 *  rekomendasi kontrol senyap #4) — sinkron dengan PushKind di
 *  src/lib/push.ts. "test" sengaja TIDAK termasuk; jenis tak dikenal juga
 *  ditolak sehingga hanya pesanan/pembayaran/status/chat/kurir yang tampil. */
private val SYSTEM_NOTIF_KINDS = setOf(
    "new_order",
    "order_paid",
    "order_status",
    "chat",
    "courier_task",
)

class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        PushRegistrar.storeAndRegister(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val kind = data["kind"] ?: ""
        val title = message.notification?.title ?: data["title"] ?: ""
        val body = message.notification?.body ?: data["body"] ?: ""
        val url = data["url"] ?: "/"
        val tag = data["tag"] ?: "agsi"
        val orderId = data["orderId"]
        // Pesanan sama saling mengganti, bukan menumpuk (sinkron data.tag server)
        val id = (orderId ?: title).hashCode()

        // ===== Kontrol notifikasi senyap (v1.3.8) =====
        // 1. Notifikasi uji TIDAK PERNAH tampil sebagai notifikasi sistem
        //    (endpoint uji juga dimatikan di production — api/push/send).
        //    Saat aplikasi terbuka tetap diteruskan ke halaman agar uji di
        //    lingkungan development tetap terlihat real-time.
        if (kind == "test") {
            if (AgsiApp.isForeground) forwardToPage(kind, title, body, url, orderId, tag)
            return
        }
        // 2. Judul & isi kosong → jangan buat notifikasi apa pun + hapus sisa
        //    notifikasi kosong lama dengan tag sama dari NotificationManager
        //    (rekomendasi #1 & #5).
        if (title.isBlank() && body.isBlank()) {
            NotificationManagerCompat.from(this).cancel(tag, id)
            return
        }

        // ===== Aplikasi TERBUKA (v1.3.14 — permintaan pemilik: notifikasi
        // muncul di STATUS BAR, bukan di dalam aplikasi): kartu PENUH
        // heads-up + suara khas AGSI + getar, SAMA seperti saat aplikasi
        // ditutup — tanpa lagi tampilan di dalam halaman (popup/suite web
        // dimatikan di NotifWatchers saat native, jadi tidak ada suara
        // dobel). Event tetap diteruskan ke halaman hanya untuk segarkan
        // data (daftar pesanan & badge chat).
        if (AgsiApp.isForeground) {
            val channelFg = if (kind == "chat") AgsiApp.CHANNEL_CHAT else AgsiApp.CHANNEL_ORDERS
            AgsiNotifications.show(
                this,
                kind = kind,
                tag = tag,
                id = id,
                title = title,
                body = body,
                url = url,
                channel = channelFg,
                chatQuickReply = kind == "chat",
            )
            forwardToPage(kind, title, body, url, orderId, tag)
            return
        }

        // ===== Aplikasi di latar belakang: heads-up notifikasi sistem
        // 3. Hanya jenis PENTING yang tampil sebagai notifikasi sistem
        //    (rekomendasi #4); jenis lain = data senyap untuk halaman saja.
        if (kind !in SYSTEM_NOTIF_KINDS) return
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        // Chat CS tampil di channel sendiri agar bisa diatur terpisah
        val channel = if (kind == "chat") AgsiApp.CHANNEL_CHAT else AgsiApp.CHANNEL_ORDERS

        // v1.3.10: pembuatan kartu notifikasi dipindah ke AgsiNotifications —
        // satu pintu untuk 10 fitur notifikasi (heads-up, layar kunci penuh +
        // full-screen intent, suara khas AGSI, getar kuat, grouping +
        // ringkasan, badge angka, quick reply chat, deep link, pusat
        // notifikasi). Pesanan sama saling mengganti (id dari orderId).
        AgsiNotifications.show(
            this,
            kind = kind,
            tag = tag,
            id = id,
            title = title,
            body = body,
            url = url,
            channel = channel,
            chatQuickReply = kind == "chat",
        )
    }

    /** Teruskan push ke halaman web (saat aplikasi terbuka): broadcast →
     *  MainActivity → event JS "agsi-push" → popup + suara + refresh instan.
     *  Detail event dipakai watcher web (src/components/shared/NotifWatchers.tsx).
     *  v1.3.11: perekaman Pusat Notifikasi cukup di AgsiNotifications.show()
     *  (kartu senyap foreground juga lewat sana) — tidak direkam dobel di sini. */
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
