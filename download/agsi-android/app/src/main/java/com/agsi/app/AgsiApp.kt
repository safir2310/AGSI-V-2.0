package com.agsi.app

import android.app.Activity
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings

/**
 * Application AGSI.
 *
 * Tugas:
 *  1. Membuat notification channel "agsi_orders" — ID WAJIB sama dengan
 *     ANDROID_CHANNEL_ID di backend (src/lib/push.ts) agar pesan FCM
 *     dengan android.notification.channel_id tampil heads-up.
 *  2. Melacak status foreground (dipakai PushService & kebijakan banner).
 */
class AgsiApp : Application() {

    companion object {
        /**
         * ID channel v1.3.4+ — suara NOTIFIKASI BIASA (permintaan pemilik:
         * kembalikan suara alarm v1.3.3 ke suara notifikasi), tetap tampil
         * penuh di layar kunci dan membangunkan layar HP yang tidur (full
         * -screen intent). ID BARU ("_v3") karena Android TIDAK mengizinkan
         * kode mengubah setelan (suara/vibrasi) channel yang sudah terpasang
         * di perangkat. WAJIB sinkron dengan src/lib/push.ts.
         */
        const val CHANNEL_ORDERS = "agsi_orders_v3"

        /** Channel chat CS v1.3.4+ (pesanan & chat dipisah agar bisa diatur sendiri) */
        const val CHANNEL_CHAT = "agsi_chat_v3"

        /**
         * Channel LAMA yang dihapus saat migrasi v1.3.4: v1 (≤1.3.2) &
         * v2 (v1.3.3, suara alarm) milik pesanan/chat, plus channel layanan
         * TERLIHAT (v1.2.4–v1.3.0).
         */
        val LEGACY_CHANNELS = arrayOf(
            "agsi_orders",
            "agsi_orders_v2",
            "agsi_chat",
            "agsi_chat_v2",
            "agsi_service",
        )

        /**
         * Channel layanan pemantau TERSEMBUNYI (v1.3.1+) — ID BARU, bukan
         * sekadar menurunkan importance "agsi_service", karena Android
         * TIDAK mengizinkan kode mengubah importance channel yang sudah
         * terpasang di perangkat (v1.2.4–v1.3.0 dibuat IMPORTANCE_MIN yang
         * tampil di daftar notifikasi).
         */
        const val CHANNEL_SERVICE_HIDDEN = "agsi_service_hidden"

        /** true bila ada Activity yang tampil di depan */
        @Volatile
        var isForeground = false
            private set
    }

    private var startedActivities = 0

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {
                startedActivities++
                isForeground = startedActivities > 0
            }

            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}

            override fun onActivityStopped(activity: Activity) {
                startedActivities = maxOf(0, startedActivities - 1)
                isForeground = startedActivities > 0
            }

            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return

        // 🔔 Suara NOTIFIKASI BIASA (default sistem) — permintaan pemilik
        // v1.3.4: ganti suara alarm v1.3.3. USAGE_NOTIFICATION mengikuti
        // slider volume notifikasi seperti biasa.
        val notificationAudio = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val orders = NotificationChannel(
            CHANNEL_ORDERS,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = getString(R.string.notification_channel_desc)
            setSound(defaultNotificationSound(), notificationAudio)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 250, 150, 250)
            // 🔒 Tampil PENUH di layar kunci — detail pesanan terbaca tanpa buka kunci
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(orders)

        val chat = NotificationChannel(
            CHANNEL_CHAT,
            getString(R.string.channel_chat_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = getString(R.string.channel_chat_desc)
            setSound(defaultNotificationSound(), notificationAudio)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 200, 120, 200)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(chat)

        // Channel layanan pemantau — TERSEMBUNYI TOTAL (IMPORTANCE_NONE):
        // notifikasi foreground service tidak pernah tampil di status bar /
        // daftar notifikasi / lock screen (permintaan pemilik v1.3.1:
        // "sembunyikan notifikasi AGSI aktif"). Notifikasi tetap di-post
        // karena wajib untuk foreground service, tapi user tidak melihatnya.
        val service = NotificationChannel(
            CHANNEL_SERVICE_HIDDEN,
            getString(R.string.channel_service_name),
            NotificationManager.IMPORTANCE_NONE,
        ).apply {
            description = getString(R.string.channel_service_desc)
            setShowBadge(false)
        }
        nm.createNotificationChannel(service)

        // Bersihkan SEMUA channel lama saat migrasi: layanan TERLIHAT
        // (≤ v1.3.0) serta pesanan/chat v1 (≤ v1.3.2) & v2 bersuara alarm
        // (v1.3.3) — migrasi ke channel v3 bersuara notifikasi biasa.
        for (legacy in LEGACY_CHANNELS) {
            nm.deleteNotificationChannel(legacy)
        }
    }

    /** URI suara NOTIFIKASI BAWAAN sistem (suara notifikasi biasa). */
    private fun defaultNotificationSound(): Uri {
        return Settings.System.DEFAULT_NOTIFICATION_URI
    }
}
