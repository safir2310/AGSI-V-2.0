package com.agsi.app

import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat

/**
 * AgsiNotifications — SATU PINTU semua notifikasi sistem AGSI (v1.3.10).
 * Dipakai PushService (FCM) dan NotifPollerService (polling latar belakang)
 * sehingga setiap kartu notifikasi konsisten memenuhi 10 fitur notifikasi:
 *
 *  1. HEADS-UP BANNER  — channel IMPORTANCE_HIGH + PRIORITY_HIGH.
 *  2. LOCK SCREEN PUSH — VISIBILITY_PUBLIC (detail terbaca tanpa buka kunci).
 *     v1.3.36 (permintaan pemilik): saat layar mati/terkunci NOTIFIKASI SAJA
 *     — aplikasi TIDAK dibuka otomatis (full-screen intent dilepas & flag
 *     show-when-locked dihapus); ketukan kartu tetap membuka aplikasi setelah
 *     buka kunci (alur baku Android).
 *  3. NOTIFICATION SOUND — suara khas AGSI ("chime" ganda) dari channel v4
 *     (res/raw/agsi_chime.wav, lihat AgsiApp).
 *  4. VIBRATION ALERT  — pola getar kuat di channel v4.
 *  5. NOTIFICATION GROUPING — kartu digabung per kelompok (Pesanan / Chat);
 *     sejak kartu kedua muncul notifikasi RINGKASAN (GroupSummary, InboxStyle)
 *     "N kabar baru dari AGSI".
 *  6. NOTIFICATION BADGE — angka pesan belum dibaca pada notifikasi chat
 *     (setNumber) + badge ikon launcher otomatis dari channel (showBadge).
 *  7. QUICK REPLY — aksi "Balas" pada notifikasi chat (RemoteInput →
 *     ChatReplyReceiver → POST /api/chat dengan cookie sesi web).
 *  8. DEEP LINK — tap kartu membuka halaman terkait: MainActivity menerima
 *     EXTRA_NAV_URL lalu menyuntikkan event "agsi-nav" ke SPA (lihat
 *     MainActivity; path "/orders" & "/chat" kini benar-benar berfungsi).
 *  9. NOTIFICATION CENTER — setiap notifikasi direkam ke NotifHistory dan
 *     dibaca halaman "Pusat Notifikasi" via jembatan AgsiNative.
 * 10. BACKGROUND PUSH SERVICE — penyedia notifikasi saat aplikasi ditutup
 *     (PushService FCM + NotifPollerService, lihat masing-masing).
 */
object AgsiNotifications {

    private const val GROUP_ORDERS = "agsi_group_orders"
    private const val GROUP_CHAT = "agsi_group_chat"
    private const val SUMMARY_TAG_ORDERS = "agsi_summary_orders"
    private const val SUMMARY_TAG_CHAT = "agsi_summary_chat"
    private const val SUMMARY_ID_ORDERS = 99_001
    private const val SUMMARY_ID_CHAT = 99_002
    private const val REPLY_KEY = "agsi_reply"
    private const val REPLY_OK_TAG = "agsi_reply_ok"

    /** Kartu per kelompok: tag → (judul, waktu, senyap?) — bahan ringkasan. */
    private val groupCards = linkedMapOf(
        GROUP_ORDERS to linkedMapOf<String, Triple<String, Long, Boolean>>(),
        GROUP_CHAT to linkedMapOf<String, Triple<String, Long, Boolean>>(),
    )

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * v1.3.36 — layar mati ATAU terkunci? Dipakai untuk memutuskan apakah
     * notifikasi boleh memunculkan aplikasi (full-screen intent) atau cukup
     * tampil sebagai kartu notifikasi biasa (permintaan pemilik: "saat layar
     * HP terkunci jangan buka aplikasi, tampilkan notifikasi saja").
     */
    private fun deviceLockedOrAsleep(ctx: Context): Boolean {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val asleep = pm?.isInteractive == false
        val locked = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            km?.isKeyguardLocked == true else km?.inKeyguardRestrictedInputMode() == true
        return asleep || locked
    }

    /** PendingIntent deep-link: buka MainActivity lalu navigasi ke url. */
    fun deepLinkIntent(ctx: Context, url: String): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
            putExtra(MainActivity.EXTRA_NAV_URL, url)
        }
        return PendingIntent.getActivity(
            ctx,
            url.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * Tampilkan satu notifikasi + rekam ke pusat notifikasi + kelola grup.
     *
     * @param unreadCount jumlah pesan belum dibaca (badge angka; 0 = tanpa angka)
     * @param chatQuickReply true → sertakan aksi "Balas" (quick reply)
     * @param silent true → kartu SENYAP (dipakai saat aplikasi TERBUKA):
     *   tetap mengisi status bar & layar kunci, tetapi tanpa suara/getar/
     *   heads-up — suara tetap satu, dari popup halaman (anti suara dobel).
     */
    fun show(
        ctx: Context,
        kind: String,
        tag: String,
        id: Int,
        title: String,
        body: String,
        url: String,
        channel: String,
        unreadCount: Int = 0,
        chatQuickReply: Boolean = false,
        silent: Boolean = false,
    ) {
        // Pusat Notifikasi: rekam SEKALIAN KALAU PUN izin notifikasi mati —
        // riwayat tetap lengkap saat pengguna membuka pusat notifikasi.
        NotifHistory.add(ctx, kind, tag, title, body, url)
        if (title.isBlank() && body.isBlank()) return

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(
                ctx, android.Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED
        ) return

        val content = deepLinkIntent(ctx, url)
        val group = if (channel == AgsiApp.CHANNEL_CHAT) GROUP_CHAT else GROUP_ORDERS

        // v1.3.11: kartu SENYAP hanya saat aplikasi sedang TERBUKA — status
        // bar & layar kunci tetap terisi, suara/getar tetap dari popup
        // halaman (anti suara dobel). Saat aplikasi ditutup / layar terkunci
        // → kartu PENUH: status bar + layar kunci + suara khas AGSI + getar
        // + heads-up.
        //
        // v1.3.36 (permintaan pemilik): full-screen intent (membangunkan
        // layar & menampilkan aplikasi di atas kunci) HANYA saat layar menyala
        // dan tidak terkunci. Saat layar mati/terkunci → NOTIFIKASI SAJA:
        // kartu masuk layar kunci + suara + getar, aplikasi tidak dibuka;
        // ketukan kartu tetap membuka aplikasi setelah buka kunci.
        val builder = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // 🔒 Tampil PENUH di layar kunci — detail terbaca tanpa buka kunci
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(content)
            .setGroup(group)
        if (silent) {
            builder
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setSilent(true)
        } else {
            builder
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(android.app.Notification.DEFAULT_LIGHTS)
            // ⏰ Full-screen intent hanya saat layar aktif & tak terkunci —
            //    suara, getar & heads-up tetap mengikuti setelan channel v4
            if (!deviceLockedOrAsleep(ctx)) {
                builder.setFullScreenIntent(content, true)
            }
        }
        if (unreadCount > 0) builder.setNumber(unreadCount)
        if (chatQuickReply) builder.addAction(replyAction(ctx, tag, id))

        try {
            NotificationManagerCompat.from(ctx).notify(tag, id, builder.build())
        } catch (_: SecurityException) {
            return
        }
        trackGroupAndSummarize(ctx, group, tag, title, silent)
    }

    // ==================== Pengelompokan + ringkasan ====================

    private fun trackGroupAndSummarize(
        ctx: Context,
        group: String,
        tag: String,
        title: String,
        silent: Boolean,
    ) {
        val cards = groupCards[group] ?: return
        cards[tag] = Triple(title, System.currentTimeMillis(), silent)
        // Buang kartu yang tercatat lebih dari 10 menit lalu (sudah lama tak relevan)
        val now = System.currentTimeMillis()
        cards.entries.removeIf { now - it.value.second > 10 * 60_000L }
        if (cards.size < 2) return // kartu tunggal tak perlu ringkasan

        val channel = if (group == GROUP_CHAT) AgsiApp.CHANNEL_CHAT else AgsiApp.CHANNEL_ORDERS
        val latest = cards.entries.toList().takeLast(3)
        val summaryUrl = if (group == GROUP_CHAT) "/chat" else "/orders"
        val style = NotificationCompat.InboxStyle()
        for ((_, pair) in latest) style.addLine(pair.first)
        style.setSummaryText("${cards.size} kabar baru dari AGSI")

        val summary = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("AGSI — ${cards.size} kabar baru")
            .setContentText(latest.lastOrNull()?.value?.first ?: "")
            .setStyle(style)
            .setPriority(
                if (silent) NotificationCompat.PRIORITY_DEFAULT
                else NotificationCompat.PRIORITY_HIGH
            )
            .setSilent(silent)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setGroup(group)
            .setGroupSummary(true)
            .setAutoCancel(true)
            .setContentIntent(deepLinkIntent(ctx, summaryUrl))
            .build()
        try {
            val nm = NotificationManagerCompat.from(ctx)
            if (group == GROUP_CHAT) nm.notify(SUMMARY_TAG_CHAT, SUMMARY_ID_CHAT, summary)
            else nm.notify(SUMMARY_TAG_ORDERS, SUMMARY_ID_ORDERS, summary)
        } catch (_: SecurityException) {
        }
    }

    // ==================== Quick Reply ====================

    private fun replyAction(ctx: Context, tag: String, id: Int): NotificationCompat.Action {
        val remoteInput = RemoteInput.Builder(REPLY_KEY)
            .setLabel("Balas pesan…")
            .build()
        val intent = Intent(ctx, ChatReplyReceiver::class.java).apply {
            action = ChatReplyReceiver.ACTION_REPLY
            putExtra(ChatReplyReceiver.EXTRA_TAG, tag)
            putExtra(ChatReplyReceiver.EXTRA_ID, id)
        }
        // RemoteInput membutuhkan PendingIntent MUTABLE (Android 12+)
        val pending = PendingIntent.getBroadcast(
            ctx,
            (tag + id).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        return NotificationCompat.Action.Builder(
            R.drawable.ic_notification, "Balas", pending
        )
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(false)
            .build()
    }

    /** Kunci teks balasan quick reply — dipakai ChatReplyReceiver. */
    const val REPLY_RESULT_KEY: String = REPLY_KEY

    /** Konfirmasi singkat "Balasan terkirim" — senyap, hilang sendiri. */
    fun showReplyConfirmation(ctx: Context, text: String, ok: Boolean) {
        val title = if (ok) "✓ Balasan terkirim" else "Gagal membalas"
        val body = if (ok) text else "Cek koneksi lalu buka menu Chat untuk mencoba lagi."
        val builder = NotificationCompat.Builder(ctx, AgsiApp.CHANNEL_CHAT)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setSilent(true) // konfirmasi balasan sendiri tak perlu bunyi
            .setAutoCancel(true)
            .setContentIntent(deepLinkIntent(ctx, "/chat"))
        val id = if (ok) "terkirim".hashCode() else "gagal".hashCode()
        try {
            NotificationManagerCompat.from(ctx).notify(REPLY_OK_TAG, id, builder.build())
        } catch (_: SecurityException) {
            return
        }
        if (ok) mainHandler.postDelayed({
            try {
                NotificationManagerCompat.from(ctx).cancel(REPLY_OK_TAG, id)
            } catch (_: Exception) {
            }
        }, 4_000)
    }
}
