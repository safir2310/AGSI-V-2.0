package com.agsi.app

import android.app.Activity
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
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
        /** ID channel — sinkron dengan src/lib/push.ts (ANDROID_CHANNEL_ID) */
        const val CHANNEL_ORDERS = "agsi_orders"

        /** Channel chat CS (pesanan & chat dipisah agar bisa diatur sendiri) */
        const val CHANNEL_CHAT = "agsi_chat"

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
        val orders = NotificationChannel(
            CHANNEL_ORDERS,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = getString(R.string.notification_channel_desc)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 250, 150, 250)
        }
        nm.createNotificationChannel(orders)

        val chat = NotificationChannel(
            CHANNEL_CHAT,
            getString(R.string.channel_chat_name),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = getString(R.string.channel_chat_desc)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 200, 120, 200)
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

        // Bersihkan channel lama yang TERLIHAT dari perangkat pemakai versi
        // sebelumnya — notifikasi "AGSI aktif" yang masih menempel ikut hilang.
        nm.deleteNotificationChannel(CHANNEL_SERVICE_LEGACY)
    }
}
