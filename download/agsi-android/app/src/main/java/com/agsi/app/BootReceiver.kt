package com.agsi.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Penerima BOOT_COMPLETED (v1.3.31 — permintaan pemilik: kartu notifikasi
 * selalu ada di status bar).
 *
 * Segera setelah HP dinyalakan ulang, layanan pemantau berjalan lagi TANPA
 * menunggu aplikasi dibuka — kartu "AGSI aktif" tampil di status bar sejak
 * awal. Saklar "Berjalan di Latar Belakang" (Profil ▸ Notifikasi Push)
 * dihormati: isEnabled false → tidak ada start sama sekali.
 *
 * startForegroundService dari receiver BOOT_COMPLETED adalah pengecualian
 * resmi pembatasan FGS latar belakang Android 12+ — sah dijalankan di sini.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        // BOOT_COMPLETED (standar) + QUICKBOOT_POWERON (varian OEM Xiaomi/
        // OPPO/realme) — keduanya "HP baru saja menyala".
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            try {
                NotifPollerService.startIfEnabled(context)
            } catch (_: Exception) {
                // Beberapa OEM membatasi start dari boot — kartu tetap muncul
                // begitu aplikasi dibuka pertama kali (MainActivity).
            }
        }
    }
}
