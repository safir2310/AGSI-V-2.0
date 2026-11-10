package com.agsi.app

import android.net.Uri

/**
 * Konfigurasi situs & keamanan navigasi WebView.
 *
 * Kebijakan URL (allowlist):
 *  - Host AGSI (WEB_APP_URL + subdomain)     → dimuat di WebView
 *  - Domain pembayaran (DOKU/Midtrans/Casaku) → dimuat di WebView
 *  - iframe / sub-resource                    → selalu dimuat dalam halaman
 *  - Skema lain (whatsapp:, tel:, intent://…) → aplikasi eksternal
 *  - http(s) di luar daftar                   → browser eksternal
 */
object SiteConfig {

    /** URL utama website AGSI (dari gradle.properties WEB_APP_URL) */
    val BASE_URL: String = BuildConfig.AGSI_BASE_URL.trimEnd('/')

    /** Host utama website produksi */
    private const val PRIMARY_HOST = "agsi-v-2-0.vercel.app"

    /**
     * Domain pembayaran yang boleh dimuat sebagai navigasi utama di WebView
     * (halaman checkout DOKU, Snap Midtrans, dsb.). iframe checkout DOKU
     * tidak lewat daftar ini — iframe selalu dimuat di dalam halaman.
     */
    private val PAYMENT_HOSTS = setOf(
        "doku.com",
        "pay.doku.com",
        "checkout.doku.com",
        "sandbox.doku.com",
        "pay.sandbox.doku.com",
        "api.doku.com",
        "api-sandbox.doku.com",
        "midtrans.com",
        "app.midtrans.com",
        "snap.midtrans.com",
        "casaku.id",
        "qriskuu.web.id",
    )

    /** true bila host milik website AGSI (utama atau subdomain) */
    fun isAllowedHost(host: String?): Boolean {
        if (host.isNullOrEmpty()) return false
        val h = host.lowercase()
        if (h == PRIMARY_HOST || h.endsWith(".$PRIMARY_HOST")) return true
        val base = Uri.parse(BASE_URL).host?.lowercase() ?: return false
        return h == base || h.endsWith(".$base")
    }

    /** true bila host termasuk domain gateway pembayaran */
    fun isPaymentHost(host: String?): Boolean {
        if (host.isNullOrEmpty()) return false
        val h = host.lowercase()
        return PAYMENT_HOSTS.any { h == it || h.endsWith(".$it") }
    }
}
