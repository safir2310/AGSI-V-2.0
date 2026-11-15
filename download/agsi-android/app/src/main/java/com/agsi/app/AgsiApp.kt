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
         * ID channel v1.3.10 — SUARA KHAS AGSI ("chime" ganda, res/raw/
         * agsi_chime.wav) + getar kuat, tetap heads-up, tampil penuh di
         * layar kunci dan membangunkan layar HP yang tidur (full-screen
         * intent), badge angka ikon launcher aktif. ID BARU ("_v4") karena
         * Android TIDAK mengizinkan kode mengubah setelan (suara/vibrasi/
         * badge) channel yang sudah terpasang di perangkat. WAJIB sinkron
         * dengan src/lib/push.ts.
         */
        const val CHANNEL_ORDERS = "agsi_orders_v4"

        /** Channel chat CS (pesanan & chat dipisah agar bisa diatur sendiri) */
        const val CHANNEL_CHAT = "agsi_chat_v4"

        /**
         * Channel LAMA yang dihapus saat migrasi: v1 (≤1.3.2), v2 (v1.3.3,
         * suara alarm), v3 (v1.3.4–v1.3.9, suara notifikasi sistem), channel
         * layanan TERLIHAT (v1.2.4–v1.3.0) dan channel layanan TERSEMBUNYI
         * (v1.3.1–v1.3.9 — notifikasi layanan dihapus total sejak v1.3.9).
         */
        val LEGACY_CHANNELS = arrayOf(
            "agsi_orders",
            "agsi_orders_v2",
            "agsi_orders_v3",
            "agsi_chat",
            "agsi_chat_v2",
            "agsi_chat_v3",
            "agsi_service",
            "agsi_service_hidden",
        )

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

        // 🔔 AUDIOATTRIBUTES notifikasi — suara mengikuti slider volume
        // notifikasi seperti biasa.
        val notificationAudio = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        // 🎵 Suara KHAS AGSI (v1.3.10 — fitur notifikasi "Notification
        // Sound"): chime ganda lembut bundel di res/raw/agsi_chime.wav.
        val agsiChime = Uri.parse("android.resource://$packageName/raw/agsi_chime")

        val orders = NotificationChannel(
            CHANNEL_ORDERS,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = getString(R.string.notification_channel_desc)
            setSound(agsiChime, notificationAudio)
            enableVibration(true)
            // 🔴 Getar KUAT khas pesanan masuk ("Vibration Alert")
            vibrationPattern = longArrayOf(0, 300, 120, 300, 120, 300)
            // 🔒 Tampil PENUH di layar kunci — detail pesanan terbaca tanpa buka kunci
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            // 🅾️ Badge angka di ikon aplikasi ("Notification Badge")
            setShowBadge(true)
        }
        nm.createNotificationChannel(orders)

        val chat = NotificationChannel(
            CHANNEL_CHAT,
            getString(R.string.channel_chat_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = getString(R.string.channel_chat_desc)
            setSound(agsiChime, notificationAudio)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 200, 120, 200)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(true)
        }
        nm.createNotificationChannel(chat)

        // Bersihkan SEMUA channel lama saat migrasi (lihat LEGACY_CHANNELS):
        // layanan terlihat/tersembunyi serta pesanan/chat v1–v3.
        for (legacy in LEGACY_CHANNELS) {
            nm.deleteNotificationChannel(legacy)
        }
    }
}
