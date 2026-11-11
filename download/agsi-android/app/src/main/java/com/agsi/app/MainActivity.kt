package com.agsi.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * MainActivity — WebView native pembungkus website AGSI.
 *
 * Fitur:
 *  • Fullscreen responsif + edge-to-edge (menghormati status bar & navigasi)
 *  • Cookie, sesi login, localStorage, JavaScript — dipertahankan penuh
 *  • Upload gambar via galeri & kamera (permission runtime)
 *  • Link WhatsApp/tel/mailto/intent dibuka di aplikasi eksternal
 *  • Tombol kembali Android = navigasi riwayat WebView
 *  • Halaman offline + tombol coba lagi + auto-retry saat internet kembali
 *  • Popup window.open (pembayaran) ditangani dalam overlay aman
 *  • Deep link pembayaran (intent:// e-wallet) diluncurkan ke app tujuan
 *  • Jembatan JS "AgsiNative" untuk registrasi push FCM
 *  • Masuk biometrik: layar buka kunci Face ID / sidik jari (AppLock) —
 *    aktif saat sesi tersimpan, bisa diatur lewat Profil → Login Biometrik
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "AGSI"

        /** Extra path tujuan setelah notifikasi diketuk (mis. "/orders") */
        const val EXTRA_NAV_URL = "agsi.nav_url"

        /** Penanda UA — sinkron dengan src/lib/push-client.ts (isNativeAndroidApp) */
        private const val UA_SUFFIX = " AGSIAndroidApp/"
    }

    private lateinit var root: LinearLayout
    private lateinit var contentSlot: FrameLayout
    private lateinit var popupSlot: FrameLayout
    private lateinit var offlineView: LinearLayout
    private lateinit var offlineDetail: TextView
    private lateinit var lockView: FrameLayout

    private var webView: WebView? = null
    private var popupWebView: WebView? = null
    private var offlineVisible = false

    // Layar buka kunci biometrik (AppLock)
    private var lockActive = false
    private var biometricOfferedThisRun = false

    // File chooser (upload galeri/kamera)
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraUri: Uri? = null
    private var pendingChooserParams: WebChromeClient.FileChooserParams? = null

    // Simpan file dari web (SAF "Simpan ke" utk Android 8–9 & fallback 10+)
    private var pendingSaveCbId: String? = null
    private var pendingSaveBytes: ByteArray? = null
    private var pendingSaveMime: String? = null
    private var pendingSaveName: String? = null

    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Untuk AgsiNativeBridge: posting pekerjaan ke thread utama. */
    val main: Handler get() = mainHandler

    /** Untuk AgsiNativeBridge: WebView utama yang sedang aktif (boleh null). */
    fun peekWebView(): WebView? = webView

    // ==================== Launchers ====================

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            handleFileChooserResult(result.resultCode, result.data)
        }

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val params = pendingChooserParams
            pendingChooserParams = null
            if (params != null) openFileChooser(params, includeCamera = granted)
        }

    private val notifPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** Hasil dialog "Simpan ke" (SAF) — tulis file yang diminta web via bridge */
    private val saveFileLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cbId = pendingSaveCbId
            val bytes = pendingSaveBytes
            val mime = pendingSaveMime ?: "application/octet-stream"
            val name = pendingSaveName ?: "agsi-file"
            pendingSaveCbId = null
            pendingSaveBytes = null
            pendingSaveMime = null
            pendingSaveName = null
            if (cbId == null) return@registerForActivityResult
            val uri = result.data?.data
            if (result.resultCode != RESULT_OK || uri == null || bytes == null) {
                // dibatalkan → web membiarkan senyap (tanpa notifikasi error)
                resolveBridge(cbId, false, "dibatalkan")
                return@registerForActivityResult
            }
            try {
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IOException("Tidak bisa membuka output stream")
                Toast.makeText(this, getString(R.string.file_saved, name), Toast.LENGTH_LONG).show()
                resolveBridge(cbId, true, name)
            } catch (e: Exception) {
                Log.w(TAG, "Gagal menulis file hasil dialog simpan", e)
                resolveBridge(cbId, false, "gagal menulis file")
            }
        }

    // ==================== Lifecycle ====================

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        // Sentuhan animasi: splash keluar dengan zoom lembut + fade —
        // transisi mulus dari logo 3D ke aplikasi (Android 12+; kompat
        // <12 oleh core-splashscreen).
        splash.setOnExitAnimationListener { provider ->
            provider.view.animate()
                .alpha(0f)
                .scaleX(1.14f)
                .scaleY(1.14f)
                .setDuration(340L)
                .setInterpolator(DecelerateInterpolator())
                .withEndAction { provider.remove() }
                .start()
        }
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        contentSlot = findViewById(R.id.content_slot)
        popupSlot = findViewById(R.id.popup_slot)
        offlineView = findViewById(R.id.offline_view)
        offlineDetail = findViewById(R.id.offline_detail)
        lockView = findViewById(R.id.lock_view)

        findViewById<Button>(R.id.btn_retry).setOnClickListener { loadSite() }
        findViewById<Button>(R.id.btn_lock_retry).setOnClickListener { startLockPrompt() }
        findViewById<Button>(R.id.btn_lock_password).setOnClickListener { lockPasswordFallback() }

        applyEdgeToEdge()
        setupBackHandler()

        attachWebView()
        registerNetworkCallback()
        ensureNotificationPermission()

        loadSite(navUrlFromIntent(intent))
        // Ambil & daftarkan token FCM (anonim dulu; terikat akun setelah login
        // lewat jembatan AgsiNative — kontrak src/components/shared/PushBridge.tsx)
        PushRegistrar.fetchAndRegisterLater(this)
        // Layanan pemantau notifikasi latar belakang — pesanan baru, update
        // status & chat tetap muncul sebagai notifikasi layar walau aplikasi
        // ditutup (bisa dimatikan dari Profil → Notifikasi Push).
        NotifPollerService.startIfEnabled(this)
        // Layar buka kunci biometrik — hanya saat aplikasi benar-benar baru
        // dibuka (bukan rotasi/rekreasi) dan sesi login masih tersimpan.
        maybeShowLockGate(savedInstanceState == null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = navUrlFromIntent(intent) ?: return
        mainHandler.post { loadSite(url) }
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        PushRegistrar.syncRegistration(this)
    }

    override fun onPause() {
        webView?.onPause()
        // Simpan cookie sesi segera ke disk agar login bertahan
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        unregisterNetworkCallback()
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        dismissPopup()
        webView?.let {
            it.stopLoading()
            it.destroy()
        }
        webView = null
        super.onDestroy()
    }

    // ==================== Setup ====================

    /** Edge-to-edge: status/nav bar transparan, konten di dalam inset aman. */
    private fun applyEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }
    }

    /** Tombol kembali: tutup popup → mundur riwayat web → minimize (sesi aman). */
    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    popupWebView != null -> dismissPopup()
                    webView?.canGoBack() == true -> webView?.goBack()
                    else -> if (!moveTaskToBack(true)) finishAffinity()
                }
            }
        })
    }

    private fun attachWebView() {
        val wv = createWebView()
        webView = wv
        contentSlot.addView(wv, 0)
        // Jembatan JS untuk halaman web (registrasi token push, versi aplikasi,
        // dan pengaturan masuk biometrik dari Profil → Login Biometrik)
        wv.addJavascriptInterface(
            AgsiNativeBridge(applicationContext) {
                this@MainActivity.takeIf { !isFinishing && !isDestroyed }
            },
            "AgsiNative",
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val wv = WebView(this)
        wv.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        wv.setBackgroundColor(Color.WHITE)
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true

        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            // window.open / target=_blank ditangani ChromeClient (popup aman)
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            // Penanda aplikasi native — dibaca src/lib/push-client.ts
            userAgentString = WebSettings.getDefaultUserAgent(this@MainActivity) +
                UA_SUFFIX + BuildConfig.VERSION_NAME
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            // Cookie pihak ketiga DIPERLUKAN oleh iframe checkout DOKU
            setAcceptThirdPartyCookies(wv, true)
        }

        wv.webViewClient = SiteWebViewClient()
        wv.webChromeClient = SiteWebChromeClient()
        wv.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(url, userAgent, contentDisposition, mimeType)
        }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        return wv
    }

    /** Bangun ulang WebView setelah render process mati (anti crash/layar putih). */
    private fun recreateWebView() {
        val old = webView
        webView = null
        old?.let {
            contentSlot.removeView(it)
            it.stopLoading()
            it.destroy()
        }
        attachWebView()
        loadSite()
        Toast.makeText(this, R.string.webview_recovered, Toast.LENGTH_SHORT).show()
    }

    // ==================== Muat halaman & offline ====================

    private fun navUrlFromIntent(intent: Intent?): String? {
        // EXTRA_NAV_URL = tap notifikasi lokal (PushService/NotifPollerService);
        // "url" = data payload FCM yang ditampilkan sistem saat app di latar
        // belakang (auto-display) — keduanya membuka halaman yang dituju.
        val path = intent?.getStringExtra(EXTRA_NAV_URL)?.trim()?.takeIf { it.isNotEmpty() }
            ?: intent?.getStringExtra("url")?.trim()?.takeIf { it.isNotEmpty() }
            ?: return null
        if (path.startsWith("http")) return path
        return SiteConfig.BASE_URL + if (path.startsWith("/")) path else "/$path"
    }

    private fun loadSite(url: String? = SiteConfig.BASE_URL) {
        hideOffline()
        if (!hasInternet()) {
            showOffline(null)
            return
        }
        val wv = webView ?: return
        wv.loadUrl(url ?: SiteConfig.BASE_URL)
    }

    private fun hasInternet(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun registerNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Internet kembali → muat ulang otomatis bila tadi offline
                mainHandler.postDelayed({
                    if (offlineVisible && hasInternet()) loadSite()
                }, 800)
            }
        }
        networkCallback = callback
        try {
            cm.registerDefaultNetworkCallback(callback)
        } catch (e: Exception) {
            Log.w(TAG, "NetworkCallback tidak tersedia", e)
        }
    }

    private fun unregisterNetworkCallback() {
        networkCallback?.let { cb ->
            try {
                (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
                    .unregisterNetworkCallback(cb)
            } catch (_: Exception) {
                // sudah tidak terdaftar
            }
        }
        networkCallback = null
    }

    private fun showOffline(detail: String?) {
        offlineVisible = true
        offlineView.visibility = View.VISIBLE
        offlineDetail.text = detail?.takeIf { it.isNotBlank() }
            ?: getString(R.string.offline_message)
    }

    private fun hideOffline() {
        offlineVisible = false
        offlineView.visibility = View.GONE
    }

    // ==================== Masuk biometrik (Face ID / sidik jari) ====================

    /** true bila cookie sesi login web (agsi_session) masih tersimpan. */
    private fun hasSessionCookie(): Boolean {
        val raw = CookieManager.getInstance().getCookie(SiteConfig.BASE_URL + "/") ?: return false
        val prefix = "agsi_session="
        return raw.split(";").any {
            val pair = it.trim()
            pair.startsWith(prefix) && pair.length > prefix.length
        }
    }

    /** Layar buka kunci saat aplikasi baru dibuka + sesi ada + fitur aktif. */
    private fun maybeShowLockGate(coldStart: Boolean) {
        if (!coldStart || !hasSessionCookie()) return
        if (AppLock.shouldGate(this, hasSession = true)) showLock()
    }

    private fun showLock() {
        if (lockActive) return
        lockActive = true
        lockView.visibility = View.VISIBLE
        startLockPrompt()
    }

    private fun startLockPrompt() {
        AppLock.authenticate(
            this,
            title = getString(R.string.lock_prompt_title),
            subtitle = getString(R.string.lock_prompt_subtitle),
            negativeText = getString(R.string.lock_prompt_negative),
        ) { ok, _ ->
            if (!lockActive) return@authenticate
            if (ok) {
                hideLock()
            } else {
                Toast.makeText(this, R.string.lock_failed_toast, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun hideLock() {
        lockActive = false
        lockView.visibility = View.GONE
    }

    /** Fallback aman: keluar dari sesi lalu tampilkan halaman login web. */
    private fun lockPasswordFallback() {
        AlertDialog.Builder(this)
            .setTitle(R.string.lock_password_confirm_title)
            .setMessage(R.string.lock_password_confirm_message)
            .setPositiveButton(R.string.lock_password_confirm_ok) { _, _ ->
                clearSessionCookie()
                hideLock()
                loadSite(SiteConfig.BASE_URL)
            }
            .setNegativeButton(R.string.lock_password_confirm_cancel, null)
            .show()
    }

    /** Hapus hanya cookie sesi (localStorage keranjang dll. tetap aman). */
    private fun clearSessionCookie() {
        val cm = CookieManager.getInstance()
        val expiry = "agsi_session=; Path=/; Max-Age=0; Secure"
        cm.setCookie(SiteConfig.BASE_URL + "/", expiry)
        cm.setCookie(SiteConfig.BASE_URL, expiry)
        cm.flush()
    }

    /**
     * Tawarkan aktivasi sekali: pengguna login di web + sensor siap + belum
     * aktif + belum pernah menolak. Dialog muncul segera setelah halaman siap.
     */
    private fun maybeOfferBiometric() {
        if (biometricOfferedThisRun || lockActive) return
        if (!hasSessionCookie()) return
        if (AppLock.isEnabled(this) || AppLock.hasDeclined(this)) return
        if (AppLock.availability(this) != AppLock.Availability.OK) return
        biometricOfferedThisRun = true
        AlertDialog.Builder(this)
            .setTitle(R.string.biometric_offer_title)
            .setMessage(R.string.biometric_offer_message)
            .setNegativeButton(R.string.biometric_offer_later) { _, _ ->
                AppLock.setDeclined(this, true)
            }
            .setPositiveButton(R.string.biometric_offer_enable) { _, _ ->
                showBiometricEnableFlow(
                    onSuccess = {
                        Toast.makeText(this, R.string.biometric_enabled_toast, Toast.LENGTH_LONG).show()
                    },
                    onFailure = { },
                )
            }
            .show()
    }

    /**
     * Alur aktivasi biometrik (dipakai dialog tawaran & Profil → Login
     * Biometrik via jembatan AgsiNative). Verifikasi dulu, baru disimpan.
     */
    fun showBiometricEnableFlow(onSuccess: () -> Unit, onFailure: (String) -> Unit) {
        when (AppLock.availability(this)) {
            AppLock.Availability.OK -> Unit
            AppLock.Availability.NOT_ENROLLED -> {
                Toast.makeText(this, R.string.biometric_not_enrolled, Toast.LENGTH_LONG).show()
                onFailure("not_enrolled")
                return
            }
            AppLock.Availability.NO_HARDWARE -> {
                Toast.makeText(this, R.string.biometric_no_hardware, Toast.LENGTH_LONG).show()
                onFailure("no_hardware")
                return
            }
        }
        AppLock.authenticate(
            this,
            title = getString(R.string.biometric_enable_prompt_title),
            subtitle = getString(R.string.biometric_enable_prompt_subtitle),
            negativeText = getString(R.string.biometric_enable_prompt_negative),
        ) { ok, code ->
            if (ok) {
                AppLock.setEnabled(this, true)
                onSuccess()
            } else {
                onFailure(
                    when (code) {
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON -> "dibatalkan"
                        else -> "verifikasi gagal"
                    }
                )
            }
        }
    }

    // ==================== Navigasi eksternal ====================

    /**
     * Buka URL/skema di aplikasi eksternal (WhatsApp, telepon, email, peta,
     * aplikasi e-wallet via intent://, browser). Selalu return true agar URL
     * tidak dimuat di WebView.
     */
    private fun launchExternal(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        try {
            if (scheme == "intent") {
                val intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                startActivity(intent)
                return true
            }
            startActivity(
                Intent(Intent.ACTION_VIEW, uri)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            return true
        } catch (e: ActivityNotFoundException) {
            // intent:// tanpa aplikasi penerima → coba fallback browser
            if (scheme == "intent") {
                val fallback = uri.getQueryParameter("S.browser_fallback_url")
                if (fallback != null) {
                    try {
                        startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(fallback))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                        return true
                    } catch (_: ActivityNotFoundException) {
                        // lanjut ke pesan di bawah
                    }
                }
            }
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
            return true
        } catch (e: Exception) {
            Log.w(TAG, "Gagal membuka tautan eksternal: $uri", e)
            return true
        }
    }

    // ==================== Popup window.open (pembayaran) ====================

    private fun showPopup() {
        if (popupWebView != null) return
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.agsi_orange))
        }
        val title = TextView(this).apply {
            text = getString(R.string.popup_title)
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
            )
        }
        val close = TextView(this).apply {
            text = "✕"
            setTextColor(Color.WHITE)
            textSize = 18f
            setPadding(dp(14), dp(4), dp(14), dp(4))
            setOnClickListener { dismissPopup() }
        }
        header.addView(title)
        header.addView(close)

        val popup = createPopupWebView()
        popupWebView = popup
        container.addView(header)
        container.addView(
            popup,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
            )
        )
        popupSlot.addView(container)
        popupSlot.visibility = View.VISIBLE
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createPopupWebView(): WebView {
        val wv = WebView(this)
        wv.setBackgroundColor(Color.WHITE)
        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            userAgentString = WebSettings.getDefaultUserAgent(this@MainActivity) +
                UA_SUFFIX + BuildConfig.VERSION_NAME
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        wv.webViewClient = SiteWebViewClient()
        wv.webChromeClient = SiteWebChromeClient()
        return wv
    }

    private fun dismissPopup() {
        val popup = popupWebView
        popupWebView = null
        popupSlot.removeAllViews()
        popupSlot.visibility = View.GONE
        // Destroy di frame berikutnya agar tidak crash saat JS masih jalan
        mainHandler.post {
            popup?.apply {
                stopLoading()
                destroy()
            }
        }
    }

    // ==================== Unduhan ====================

    private fun startDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        try {
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle(fileName)
                .setDescription(getString(R.string.download_desc))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            CookieManager.getInstance().getCookie(url)?.let {
                request.addRequestHeader("Cookie", it)
            }
            request.addRequestHeader("User-Agent", userAgent ?: "AGSIAndroidApp")
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.w(TAG, "Unduhan gagal — buka lewat aplikasi eksternal", e)
            // URL blob: tidak bisa dibuka aplikasi eksternal mana pun — dulu
            // fallback startActivity memunculkan toast "Tidak ada aplikasi yang
            // bisa membuka tautan ini". File dari web kini lewat AgsiNative
            // .saveFile, jadi jalur ini hanya jaring pengaman yang ramah.
            if (url.startsWith("blob:")) {
                Toast.makeText(this, R.string.download_unsupported, Toast.LENGTH_SHORT).show()
            } else {
                launchExternal(Uri.parse(url))
            }
        }
    }

    // ==================== Simpan file dari web & cetak (jembatan AgsiNative) ====================

    /** Kirim hasil operasi bridge ke web: window.__agsiNativeResult({id, ok, message}) */
    fun resolveBridge(cbId: String, ok: Boolean, message: String) {
        val payload = JSONObject().apply {
            put("id", cbId)
            put("ok", ok)
            put("message", message)
        }
        val script = "window.__agsiNativeResult && window.__agsiNativeResult(${payload})"
        val wv = peekWebView()
        wv?.post { wv.evaluateJavascript(script, null) }
    }

    /**
     * Simpan file (base64 dari web) ke folder Unduhan.
     *  - Android 10+ : MediaStore Downloads → Unduhan/AGSI, tanpa dialog,
     *    plus toast konfirmasi.
     *  - Android 8–9 : dialog "Simpan ke" (SAF ACTION_CREATE_DOCUMENT) —
     *    tanpa izin penyimpanan.
     */
    fun saveFileToDownloads(cbId: String, base64: String, fileName: String, mimeType: String) {
        val bytes = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (e: Exception) {
            Log.w(TAG, "Base64 dari web tidak valid", e)
            resolveBridge(cbId, false, "data file tidak valid")
            return
        }
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                val resolver = contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AGSI")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IOException("MediaStore menolak penyimpanan")
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IOException("Tidak bisa membuka output stream")
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                Toast.makeText(this, getString(R.string.file_saved, fileName), Toast.LENGTH_LONG).show()
                resolveBridge(cbId, true, fileName)
            } catch (e: Exception) {
                Log.w(TAG, "MediaStore gagal — pakai dialog Simpan-ke (SAF)", e)
                launchSaveFileDialog(cbId, bytes, fileName, mimeType)
            }
        } else {
            launchSaveFileDialog(cbId, bytes, fileName, mimeType)
        }
    }

    /** Dialog "Simpan ke" (SAF) — tanpa izin penyimpanan, tersedia sejak API 19. */
    private fun launchSaveFileDialog(cbId: String, bytes: ByteArray, fileName: String, mimeType: String) {
        pendingSaveCbId = cbId
        pendingSaveBytes = bytes
        pendingSaveMime = mimeType
        pendingSaveName = fileName
        try {
            saveFileLauncher.launch(
                Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mimeType
                    putExtra(Intent.EXTRA_TITLE, fileName)
                }
            )
        } catch (e: ActivityNotFoundException) {
            pendingSaveCbId = null
            pendingSaveBytes = null
            pendingSaveMime = null
            pendingSaveName = null
            resolveBridge(cbId, false, "perangkat tidak menyediakan dialog simpan")
        }
    }

    /**
     * Dialog cetak sistem (PrintManager) di atas halaman web yang sedang tampil
     * — pengganti window.print() yang diabaikan WebView. Kertas memakai aturan
     * @media print halaman (hanya struk yang tercetak).
     */
    fun printPage(cbId: String, title: String) {
        val wv = webView
        if (wv == null) {
            resolveBridge(cbId, false, "halaman tidak siap")
            return
        }
        try {
            val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
            printManager.print(title, wv.createPrintDocumentAdapter(title), PrintAttributes.Builder().build())
            resolveBridge(cbId, true, "dialog cetak dibuka")
        } catch (e: Exception) {
            Log.w(TAG, "Gagal membuka dialog cetak", e)
            resolveBridge(cbId, false, "perangkat tidak mendukung cetak")
        }
    }

    /**
     * Buka layar pendaftaran biometrik Android — rantai fallback:
     *  1. ACTION_BIOMETRIC_ENROLL (API 30+, wajah/sidik jari)
     *  2. ACTION_FINGERPRINT_ENROLL (API 24–29)
     *  3. Keamanan & layar kunci (semua versi)
     * Android tidak mengizinkan pendaftaran biometrik langsung dari aplikasi,
     * jadi deep-link ke Pengaturan adalah pintu tercepat yang tersedia.
     */
    fun openBiometricEnrollSettings() {
        val candidates = mutableListOf<Intent>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            candidates += Intent(Settings.ACTION_BIOMETRIC_ENROLL)
        }
        @Suppress("DEPRECATION")
        candidates += Intent(Settings.ACTION_FINGERPRINT_ENROLL)
        candidates += Intent(Settings.ACTION_SECURITY_SETTINGS)
        for (intent in candidates) {
            try {
                startActivity(intent)
                return
            } catch (_: Exception) {
                // Perangkat tidak menyediakan layar ini — coba kandidat berikutnya
            }
        }
        Toast.makeText(this, R.string.biometric_enroll_unavailable, Toast.LENGTH_LONG).show()
    }

    // ==================== Upload file (galeri & kamera) ====================

    private fun openFileChooser(
        params: WebChromeClient.FileChooserParams,
        includeCamera: Boolean,
    ) {
        val accept = params.acceptTypes?.firstOrNull { it.contains("/") } ?: "*/*"
        val gallery = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = accept
            if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
        }

        val extraIntents = mutableListOf<Intent>()
        if (includeCamera) {
            pendingCameraUri = createCameraFile()
            pendingCameraUri?.let { cameraUri ->
                extraIntents += Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    )
                }
            }
        }

        val chooser = if (extraIntents.isEmpty()) gallery
        else Intent.createChooser(gallery, getString(R.string.file_chooser_title)).apply {
            putExtra(Intent.EXTRA_INITIAL_INTENTS, extraIntents.toTypedArray())
        }

        try {
            fileChooserLauncher.launch(chooser)
        } catch (e: ActivityNotFoundException) {
            failFileChooser(getString(R.string.file_chooser_none))
        }
    }

    private fun failFileChooser(message: String) {
        pendingCameraUri = null
        val cb = fileChooserCallback
        fileChooserCallback = null
        cb?.onReceiveValue(null)
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun handleFileChooserResult(resultCode: Int, data: Intent?) {
        val cb = fileChooserCallback
        fileChooserCallback = null
        val cameraUri = pendingCameraUri
        pendingCameraUri = null
        if (cb == null) return

        val uris = mutableListOf<Uri>()
        if (resultCode == RESULT_OK) {
            data?.data?.let { uris.add(it) }
            if (uris.isEmpty()) {
                data?.clipData?.let { clip ->
                    for (i in 0 until clip.itemCount) {
                        clip.getItemAt(i)?.uri?.let { uris.add(it) }
                    }
                }
            }
            if (uris.isEmpty()) cameraUri?.let { uris.add(it) }
        }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    private fun createCameraFile(): Uri? {
        return try {
            val dir = File(cacheDir, "images").apply { mkdirs() }
            val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val file = File(dir, "IMG_$stamp.jpg")
            FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        } catch (e: Exception) {
            Log.w(TAG, "Gagal menyiapkan file kamera", e)
            null
        }
    }

    // ==================== Notifikasi ====================

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    // ==================== Util ====================

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    // ==================== WebViewClient ====================

    private inner class SiteWebViewClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val url = request?.url ?: return false
            val scheme = url.scheme?.lowercase()
            // Skema non-http(s): WhatsApp, tel, mailto, geo, intent:// e-wallet, dll.
            if (scheme != "http" && scheme != "https") return launchExternal(url)
            // Navigasi iframe/sub-frame selalu dimuat di dalam halaman
            // (iframe checkout DOKU dirender in-app oleh QrisPaySheet)
            if (!request.isForMainFrame) return false
            val host = url.host
            return if (SiteConfig.isAllowedHost(host) || SiteConfig.isPaymentHost(host)) {
                false // dimuat di WebView
            } else {
                launchExternal(url) // situs luar → browser/aplikasi eksternal
            }
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            hideOffline()
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            // Tawaran masuk biometrik — sedikit ditunda agar halaman selesai
            // dulu merender (dialog muncul di atas halaman yang sudah siap).
            if (url != null && SiteConfig.isAllowedHost(Uri.parse(url).host)) {
                mainHandler.postDelayed({ maybeOfferBiometric() }, 900)
            }
        }

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?,
        ) {
            super.onReceivedError(view, request, error)
            if (request?.isForMainFrame == true) {
                val code = error?.errorCode ?: 0
                val desc = error?.description?.toString() ?: ""
                showOffline(
                    getString(R.string.offline_message) + "\n\n($code: $desc)"
                )
            }
        }

        override fun onReceivedHttpError(
            view: WebView?,
            request: WebResourceRequest?,
            response: WebResourceResponse?,
        ) {
            super.onReceivedHttpError(view, request, response)
            if (request?.isForMainFrame == true && (response?.statusCode ?: 0) >= 500) {
                showOffline(
                    getString(R.string.offline_server) + " (HTTP ${response?.statusCode})"
                )
            }
        }

        override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
            // KEBIJAKAN KEAMANAN: error SSL TIDAK PERNAH diabaikan.
            handler?.cancel()
            AlertDialog.Builder(this@MainActivity)
                .setTitle(R.string.ssl_error_title)
                .setMessage(getString(R.string.ssl_error_message, error?.primaryError ?: -1))
                .setPositiveButton(R.string.ssl_error_close, null)
                .show()
        }

        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            Log.e(TAG, "WebView render process hilang — dibuat ulang")
            mainHandler.post {
                when (view) {
                    webView -> recreateWebView()
                    popupWebView -> dismissPopup()
                }
            }
            return true
        }
    }

    // ==================== WebChromeClient ====================

    private inner class SiteWebChromeClient : WebChromeClient() {

        override fun onCreateWindow(
            view: WebView?,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: Message?,
        ): Boolean {
            if (!isUserGesture || resultMsg == null) return false
            showPopup()
            val popup = popupWebView ?: return false
            val transport = resultMsg.obj as? WebView.WebViewTransport
            transport?.setWebView(popup)
            resultMsg.sendToTarget()
            return true
        }

        override fun onCloseWindow(window: WebView?) {
            if (window != null && window === popupWebView) dismissPopup()
        }

        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?,
        ): Boolean {
            if (filePathCallback == null || fileChooserParams == null) return false
            // Selesaikan callback lama agar input file tidak "macet"
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback
            val cameraAllowed = ContextCompat.checkSelfPermission(
                this@MainActivity, Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
            if (cameraAllowed) {
                openFileChooser(fileChooserParams, includeCamera = true)
            } else {
                // Minta izin kamera dulu; setelah itu galeri (+kamera bila izin)
                pendingChooserParams = fileChooserParams
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest?) {
            // getUserMedia halaman (kamera/mikrofon langsung) dinonaktifkan —
            // upload foto tetap bisa lewat input file + kamera sistem.
            request?.deny()
        }

        override fun onGeolocationPermissionsShowPrompt(
            origin: String?,
            callback: GeolocationPermissions.Callback?,
        ) {
            // Website AGSI tidak memakai geolokasi — tolak dengan rapi
            callback?.invoke(origin, false, false)
        }
    }
}
