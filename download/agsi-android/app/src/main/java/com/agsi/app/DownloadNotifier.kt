package com.agsi.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import java.io.File

/**
 * NOTIFIKASI UNDUHAN DI STATUS BAR (v1.3.28 — permintaan pemilik).
 *
 * Setiap simpan file dari web (struk PDF, laporan CSV/HTML) kini muncul
 * sebagai kartu unduhan di status bar, seperti unduhan browser:
 *  - saat proses:  "Mengunduh <nama>…" dengan progres tak pasti;
 *  - saat sukses:  "Unduhan selesai ✓ — <nama> tersimpan, ketuk untuk
 *    membuka" (tanda tangan kartu → PDF viewer / Excel / dsb.);
 *  - saat gagal:   "Unduhan gagal — <nama> tidak dapat ditulis".
 *
 * ID kartu stabil per nama file, jadi simpan ulang file yang sama
 * memperbarui kartunya (tidak menumpuk). Seluruh operasi diam-diam aman
 * bila izin notifikasi dimatikan — penyimpanan tetap berjalan.
 */
object DownloadNotifier {

    private const val TAG = "AgsiDownload"
    private const val CHANNEL = "agsi_downloads_v1"

    private fun notificationManager(ctx: Context): NotificationManager =
        ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun ensureChannel(ctx: Context) {
        if (notificationManager(ctx).getNotificationChannel(CHANNEL) != null) return
        val ch = NotificationChannel(
            CHANNEL,
            ctx.getString(R.string.channel_downloads_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = ctx.getString(R.string.channel_downloads_desc)
        }
        notificationManager(ctx).createNotificationChannel(ch)
    }

    /** ID kartu stabil per nama file (simpan ulang = perbarui kartu). */
    private fun cardId(fileName: String): Int = "agsi_dl_$fileName".hashCode()

    /** Kirim notifikasi dengan aman — izin notifikasi mati bukan galat. */
    private fun postSafely(ctx: Context, notification: Notification, cardId: Int) {
        try {
            ensureChannel(ctx)
            notificationManager(ctx).notify(cardId, notification)
        } catch (e: Exception) {
            Log.w(TAG, "Notifikasi unduhan tidak dapat ditampilkan (izin mati?)", e)
        }
    }

    private fun baseBuilder(ctx: Context): NotificationCompat.Builder =
        NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFFF97316.toInt()) // orange-500 — warna AGSI
            .setAutoCancel(true)

    /** Kartu progres "Mengunduh <fileName>…" — tampil sebelum file ditulis. */
    fun progress(ctx: Context, fileName: String) {
        val n = baseBuilder(ctx)
            .setContentTitle(ctx.getString(R.string.notif_download_progress_title, fileName))
            .setContentText(ctx.getString(R.string.notif_download_progress_text))
            .setProgress(0, 0, true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build()
        postSafely(ctx, n, cardId(fileName))
    }

    /**
     * Kartu progres dengan PERSABAGAN NYATA (v1.3.30 — permintaan pemilik:
     * unduhan struk lebih "tajam"): baris progres berisi + teks "67% · 1,2 MB".
     * Dipakai penulisan per bagian di MainActivity; kartu yang sama (id
     * stabil per nama file) diperbarui — tidak menumpuk.
     */
    fun progress(ctx: Context, fileName: String, percent: Int, bytesSoFar: Long = 0) {
        val p = percent.coerceIn(0, 100)
        val mb = bytesSoFar / (1024.0 * 1024.0)
        val detail = if (mb >= 0.1) {
            String.format(" · %.1f MB", mb)
        } else if (bytesSoFar > 0) {
            " · " + (bytesSoFar / 1024) + " KB"
        } else {
            ""
        }
        val n = baseBuilder(ctx)
            .setContentTitle(ctx.getString(R.string.notif_download_progress_title, fileName))
            .setContentText("$p%$detail")
            .setProgress(100, p, false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build()
        postSafely(ctx, n, cardId(fileName))
    }

    /**
     * Kartu selesai — ketuk membuka file (PDF viewer, Excel, dsb.).
     * `uri` = URI konten file (MediaStore / SAF); Android 8–9 jalur langsung
     * memakai FileProvider (Lihat file_paths.xml "downloads").
     */
    fun completed(ctx: Context, fileName: String, mimeType: String, uri: Uri?) {
        val builder = baseBuilder(ctx)
            .setContentTitle(ctx.getString(R.string.notif_download_done_title))
            .setContentText(ctx.getString(R.string.notif_download_done_text, fileName))
            .setOngoing(false)
        try {
            if (uri != null) {
                val view = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mimeType)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val pi = PendingIntent.getActivity(
                    ctx,
                    cardId(fileName),
                    view,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                builder.setContentIntent(pi)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Intent buka file tidak dapat dibuat", e)
        }
        postSafely(ctx, builder.build(), cardId(fileName))
    }

    /** Kartu gagal — penyimpanan menolak / penulisan terputus. */
    fun failed(ctx: Context, fileName: String) {
        val n = baseBuilder(ctx)
            .setContentTitle(ctx.getString(R.string.notif_download_failed_title))
            .setContentText(ctx.getString(R.string.notif_download_failed_text, fileName))
            .setOngoing(false)
            .build()
        postSafely(ctx, n, cardId(fileName))
    }

    /** URI FileProvider untuk file Unduhan/AGSI (Android 8–9, jalur langsung). */
    fun fileProviderUri(ctx: Context, file: File): Uri =
        FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
}
