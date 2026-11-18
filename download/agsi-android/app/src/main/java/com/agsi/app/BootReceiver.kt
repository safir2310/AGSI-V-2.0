package com.agsi.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Penerima BOOT_COMPLETED (v1.3.31, diperbarui v1.3.33).
 *
 * Segera setelah HP dinyalakan ulang, layanan pemantau berjalan lagi TANPA
 * menunggu aplikasi dibuka — notifikasi pesanan tetap terpantau sejak awal
 * (TANPA kartu notifikasi: kartu "AGSI aktif" dihapus sejak v1.3.33 —
 * permintaan pemilik: aplikasi tanpa kredensial Firebase terlihat bersih).
 * Saklar "Berjalan di Latar Belakang" (Profil ▸ Notifikasi Push) dihormati:
 * isEnabled false → tidak ada start sama sekali.
 *
 * startService dari receiver BOOT_COMPLETED sah selama jendela allowlist
 * sementara (beberapa detik setelah boot); sebagian OEM lebih ketat — bila
 * gagal, layanan tetap hidup begitu aplikasi dibuka pertama kali
 * (MainActivity.onCreate → startIfEnabled).
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
                // Beberapa OEM membatasi start dari boot — layanan tetap
                // berjalan begitu aplikasi dibuka pertama kali (MainActivity).
            }
        }
    }
}
