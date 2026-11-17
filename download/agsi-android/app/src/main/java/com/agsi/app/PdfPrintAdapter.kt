package com.agsi.app

import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

/**
 * Adapter cetak FILE PDF sungguhan lewat dialog cetak sistem Android
 * (v1.3.28 — permintaan pemilik: struk & laporan dicetak via printer sistem).
 *
 * Dipakai bersama PrintManager.print(): PDF sementara ditulis di cache
 * aplikasi, adapter mengalirkan byte-nya ke spooler cetak. Dialog sistem lalu
 * menawarkan SEMUA printer terpasang (thermal 58/80 mm via plugin printer,
 * Bluetooth, jaringan) plus opsi "Simpan sebagai PDF".
 */
class PdfPrintAdapter(
    private val pdfFile: java.io.File,
    @Suppress("UNUSED_PARAMETER") jobName: String,
) : PrintDocumentAdapter() {

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback.onLayoutCancelled()
            return
        }
        val info = PrintDocumentInfo.Builder(pdfFile.name)
            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
            .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
            .build()
        callback.onLayoutFinished(info, newAttributes != oldAttributes)
    }

    override fun onWrite(
        pages: Array<out PageRange>?,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback,
    ) {
        try {
            FileInputStream(pdfFile).use { input ->
                FileOutputStream(destination.fileDescriptor).use { output ->
                    input.copyTo(output)
                }
            }
            if (cancellationSignal?.isCanceled == true) {
                callback.onWriteCancelled()
                return
            }
            callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (e: IOException) {
            callback.onWriteFailed(e.message ?: "gagal menulis ke spooler cetak")
        }
    }

    /** Bersihkan PDF sementara di cache — HANYA di onFinish (onWrite bisa
     *  dipanggil ulang bila pengguna mengganti printer/salinan). */
    override fun onFinish() {
        try {
            pdfFile.delete()
        } catch (_: Exception) {
        }
    }
}
