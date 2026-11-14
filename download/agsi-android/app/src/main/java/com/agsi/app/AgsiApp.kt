package com.agsi.app

import android.app.Activity
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.RingtoneManager
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
         * ID channel v1.3.3+ — SUARA ALARM nyaring, getar kuat, tampil penuh
         * di layar kunci. ID BARU ("_v2"), bukan sekadar mengubah suara
         * "agsi_orders", karena Android TIDAK mengizinkan kode mengubah
         * setelan (suara/vibrasi) channel yang sudah terpasang di perangkat.
         * WAJIB sinkron dengan src/lib/push.ts (ANDROID_CHANNEL_ID).
         */
        const val CHANNEL_ORDERS = "agsi_orders_v2"

        /** Channel chat CS v1.3.3+ (pesanan & chat dipisah agar bisa diatur sendiri) */
        const val CHANNEL_CHAT = "agsi_chat_v2"

        /** Channel pesanan LAMA (≤ v1.3.2, suara notifikasi biasa) — dihapus saat migrasi */
        const val CHANNEL_ORDERS_LEGACY = "agsi_orders"

        /** Channel chat LAMA (≤ v1.3.2) — dihapus saat migrasi */
        const val CHANNEL_CHAT_LEGACY = "agsi_chat"

        /**
         * Channel layanan pemantau TERSEMBUNYI (v1.3.1+) — ID BARU, bukan
         * sekadar menurunkan importance "agsi_service", karena Android
         * TIDAK mengizinkan kode mengubah importance channel yang sudah
         * terpasang di perangkat (v1.2.4–v1.3.0 dibuat IMPORTANCE_MIN yang
         * tampil di daftar notifikasi).
         */
        const val CHANNEL_SERVICE_HIDDEN = "agsi_service_hidden"

        /** Channel layanan LAMA (v1.2.4–v1.3.0, TERLIHAT) — dihapus saat migrasi */
        const val CHANNEL_SERVICE_LEGACY = "agsi_service"

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

        // 🔊 Suara ALARM nyaring — volume mengikuti slider alarm yang di sebagian
        // besar HP berada di level maksimal, jauh lebih keras dari suara
        // notifikasi biasa. Fallback aman: ringtone → notifikasi sistem.
        val alarmAudio = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val orders = NotificationChannel(
            CHANNEL_ORDERS,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = getString(R.string.notification_channel_desc)
            setSound(loudSoundUri(), alarmAudio)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 700, 250, 700)
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
            setSound(loudSoundUri(), alarmAudio)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 700, 250, 700)
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

        // Bersihkan channel lama: layanan TERLIHAT (≤ v1.3.0) serta channel
        // pesanan/chat lama bersuara notifikasi biasa (≤ v1.3.2) — migrasi ke
        // channel v2 bersuara ALARM nyaring.
        nm.deleteNotificationChannel(CHANNEL_SERVICE_LEGACY)
        nm.deleteNotificationChannel(CHANNEL_ORDERS_LEGACY)
        nm.deleteNotificationChannel(CHANNEL_CHAT_LEGACY)
    }

    /** URI suara ALARM dengan fallback berlapis (alarm → ringtone → notifikasi). */
    private fun loudSoundUri(): Uri {
        return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ?: Settings.System.DEFAULT_NOTIFICATION_URI
    }
}
