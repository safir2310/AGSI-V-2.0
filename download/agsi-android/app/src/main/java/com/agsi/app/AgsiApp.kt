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

        /** Channel notifikasi minimal untuk layanan pemantau latar belakang */
        const val CHANNEL_SERVICE = "agsi_service"

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

        // Channel MINIMAL — notifikasi "layanan berjalan" harus senyap &
        // berada di bawah daftar notifikasi (wajib ada utk foreground service)
        val service = NotificationChannel(
            CHANNEL_SERVICE,
            getString(R.string.channel_service_name),
            NotificationManager.IMPORTANCE_MIN,
        ).apply {
            description = getString(R.string.channel_service_desc)
            setShowBadge(false)
        }
        nm.createNotificationChannel(service)
    }
}
