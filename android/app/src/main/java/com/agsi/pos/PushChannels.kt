package com.agsi.pos

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.graphics.Color

/**
 * Channel notifikasi — kunci HEADS-UP:
 * IMPORTANCE_HIGH = banner melayang di atas layar + suara/vibrasi,
 * walau HP sedang dipakai. Channel berlaku sejak app pertama dibuka
 * (dipanggil dari MainActivity.onCreate & sebelum tiap notify).
 */
object PushChannels {
    const val ORDERS = "agsi_orders"

    fun create(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val orders = NotificationChannel(
            ORDERS,
            context.getString(R.string.channel_orders_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.channel_orders_desc)
            enableLights(true)
            lightColor = Color.parseColor("#EA580C")
            enableVibration(true)
        }
        nm.createNotificationChannel(orders)
    }
}
