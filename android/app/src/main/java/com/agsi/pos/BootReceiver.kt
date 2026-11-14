package com.agsi.pos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * PENERIMA BOOT & UPDATE — menghidupkan ulang layanan keep-alive.
 *
 * Tanpa ini, notifikasi pesanan baru MATI setelah HP di-restart atau
 * aplikasi diperbarui sampai user membuka aplikasi lagi. Penjual sering
 * lupa membuka ulang — pesanan masuk bisa terlewat berjam-jam.
 *
 * Dipicu oleh:
 *  - ACTION_BOOT_COMPLETED      : HP baru menyala
 *  - QUICKBOOT_POWERON (HTC dsb): varian boot cepat OEM
 *  - ACTION_MY_PACKAGE_REPLACED : aplikasi baru saja diperbarui (APK baru)
 *
 * Mulai foreground service dari BOOT_COMPLETED / MY_PACKAGE_REPLACED
 * dikecualikan dari pembatasan background-start Android 12+.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val booted = action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON"
        val updated = action == Intent.ACTION_MY_PACKAGE_REPLACED
        if (booted || updated) {
            KeepAliveService.start(context)
        }
    }
}
