package com.agsi.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * BootReceiver — nyalakan ulang layanan pemantau notifikasi setelah HP
 * dinyalakan/direstart, bila pengguna mengaktifkannya (default aktif).
 * BOOT_COMPLETED hanya dikirim sistem, jadi aman.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        NotifPollerService.startIfEnabled(context)
    }
}
