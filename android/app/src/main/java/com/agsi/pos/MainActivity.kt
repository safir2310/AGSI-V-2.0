package com.agsi.pos

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging

/**
 * AGSI POS — pembungkus WebView aplikasi web AGSI + jembatan token FCM.
 *
 * - Memuat URL aplikasi web dari BuildConfig.WEB_APP_URL (gradle.properties).
 * - UserAgent diberi penanda "AGSIAndroidApp/…" agar halaman web tahu
 *   sedang berjalan di aplikasi (notifikasi web dimatikan di WebView,
 *   push ditangani native — tidak ada notifikasi ganda).
 * - Jembatan JS `AgsiNative.getFcmToken()` dipakai halaman (PushBridge)
 *   untuk mendaftarkan token dengan SESI LOGIN pengguna → push per role.
 * - Saat notifikasi diketuk, URL tujuan (data.url) dibuka di WebView.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        PushChannels.create(this)
        requestNotificationPermissionIfNeeded()

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            // Penanda agar halaman web tahu sedang berjalan di aplikasi Android
            userAgentString = "$userAgentString AGSIAndroidApp/${BuildConfig.VERSION_NAME}"
        }
        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.white))

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val appHost = Uri.parse(BuildConfig.WEB_APP_URL).host ?: return false
                val host = request.url.host ?: return false
                val internal = host == appHost || host.endsWith(".$appHost")
                if (!internal) {
                    // Link luar (WhatsApp, telepon, peta, dsb.) → aplikasi yang sesuai
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                        true
                    } catch (e: Exception) {
                        true
                    }
                }
                return false
            }
        }

        // Jembatan JS → halaman web mendaftarkan token FCM dengan sesi login
        webView.addJavascriptInterface(NativeBridge(), "AgsiNative")

        // Notifikasi diketuk saat app di background → buka halaman tujuan
        val target = intent?.getStringExtra(EXTRA_URL)
        webView.loadUrl(target ?: BuildConfig.WEB_APP_URL)

        // Tombol kembali → navigasi riwayat WebView dulu, baru keluar
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        // Ambil token FCM terkini → simpan + daftarkan ke server AGSI
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            FcmTokenHolder.token = token
            PushApi.registerAsync(applicationContext, token)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val target = intent.getStringExtra(EXTRA_URL)
        if (!target.isNullOrBlank()) webView.loadUrl(target)
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
    }

    companion object {
        const val EXTRA_URL = "url"
        private const val REQ_NOTIF = 1001
    }
}

/** Jembatan JS: halaman web membaca token FCM (dipakai src/lib/push-client.ts → PushBridge). */
class NativeBridge {
    @JavascriptInterface
    fun getFcmToken(): String = FcmTokenHolder.token ?: ""

    @JavascriptInterface
    fun getAppVersion(): String = BuildConfig.VERSION_NAME
}
