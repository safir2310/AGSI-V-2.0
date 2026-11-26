package com.agsi.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
import android.os.PowerManager
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
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
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
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

        /** Broadcast internal PushService → halaman web (event JS "agsi-push")
         *  saat aplikasi terbuka — popup/suara/refresh notifikasi instan. */
        const val ACTION_PUSH_RECEIVED = "agsi.PUSH_RECEIVED"

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

    // Pin GPS lokasi rumah pelanggan (navigator.geolocation di WebView) —
    // callback geolokasi yang menunggu izin runtime ACCESS_FINE_LOCATION
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null

    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var pushReceiver: BroadcastReceiver? = null
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

    /** Hasil dialog izin PENYIMPANAN (Android 8–9, WRITE_EXTERNAL_STORAGE):
     *  disetujui → struk/laporan disimpan LANGSUNG ke Unduhan/AGSI;
     *  ditolak → fallback dialog "Simpan ke" (SAF). Android 10+ tidak
     *  butuh izin ini (MediaStore). */
    private val storagePermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val cbId = pendingSaveCbId
            val bytes = pendingSaveBytes
            val mime = pendingSaveMime ?: "application/octet-stream"
            val name = pendingSaveName ?: "agsi-file"
            if (cbId == null || bytes == null) return@registerForActivityResult
            if (granted) {
                writeToPublicDownloads(cbId, bytes, name, mime)
            } else {
                launchSaveFileDialog(cbId, bytes, name, mime)
            }
        }

    /** Hasil dialog izin notifikasi — DITOLAK: penolakan pertama → popup
     *  penjelasan + pintasan setelan; penolakan kedua dst → LANGSUNG buka
     *  setelan notifikasi aplikasi (tetap dibatasi 1×/24 jam). */
    private val notifPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) onNotifPermissionDenied()
        }

    /** Hasil dialog izin lokasi — balas callback geolokasi WebView yang menunggu.
     *  Granted → halaman boleh memakai navigator.geolocation (pin GPS rumah). */
    private val locationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val origin = pendingGeoOrigin
            val cb = pendingGeoCallback
            pendingGeoOrigin = null
            pendingGeoCallback = null
            if (origin != null && cb != null) cb.invoke(origin, granted, false)
        }

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
                contentResolver.openOutputStream(uri)?.use { writeWithProgress(it, bytes, name) }
                    ?: throw IOException("Tidak bisa membuka output stream")
                Toast.makeText(this, getString(R.string.file_saved, name), Toast.LENGTH_LONG).show()
                // v1.3.28 — kartu unduhan selesai (tap → buka file hasil SAF)
                DownloadNotifier.completed(this, name, mime, uri)
                resolveBridge(cbId, true, name)
            } catch (e: Exception) {
                Log.w(TAG, "Gagal menulis file hasil dialog simpan", e)
                DownloadNotifier.failed(this, name)
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

        // v1.3.36 (permintaan pemilik): layar terkunci → NOTIFIKASI SAJA,
        // aplikasi tidak dibuka. Flag setShowWhenLocked/setTurnScreenOn dari
        // v1.3.3 (aplikasi tampil di atas layar kunci via full-screen intent)
        // dihapus — notifikasi tetap masuk kartu layar kunci + suara + getar
        // (AgsiNotifications), ketukan kartu membuka aplikasi SETELAH buka
        // kunci (alur baku Android).
        //
        // v1.3.25 — layar TIDAK terkunci sendiri selama aplikasi di depan:
        // kasir melayani pesanan tidak disela kunci layar otomatis di tengah
        // pencatatan (permintaan pemilik: "aplikasi tetap terbuka"). Tombol
        // power tetap boleh mengunci — flag ini hanya meniadkan idle timeout.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

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
        registerPushForwarder()
        registerNetworkCallback()
        registerScreenLockCloser()
        ensureNotificationPermission()

        // DEEP LINK NOTIFIKASI (v1.3.10): path tujuan (mis. "/orders") tidak
        // dimuat sebagai URL (SPA punya satu route — /orders menghasilkan
        // 404) melainkan disimpan dan disuntikkan sebagai event "agsi-nav"
        // setelah halaman selesai (onPageFinished) → AppShell membuka
        // view/halaman tujuan.
        navPathFromIntent(intent)?.let { pendingNavPath = it }
        loadSite()
        // Ambil & daftarkan token FCM (anonim dulu; terikat akun setelah login
        // lewat jembatan AgsiNative — kontrak src/components/shared/PushBridge.tsx)
        PushRegistrar.fetchAndRegisterLater(this)
        // Layanan pemantau notifikasi latar belakang — pesanan baru, update
        // status & chat tetap muncul sebagai notifikasi layar walau aplikasi
        // ditutup (bisa dimatikan dari Profil → Notifikasi Push).
        NotifPollerService.startIfEnabled(this)
        // Izin BERJALAN DI LATAR BELAKANG (v1.3.9): v1.3.26 memakai dialog
        // milik aplikasi (teks pendek: satu kalimat + TOLAK/IZINKAN) — bukan
        // dialog sistem panjang. Diminta LANGSUNG saat aplikasi dibuka,
        // ditunda 3 detik agar tidak berebut dengan dialog izin notifikasi
        // & gate kunci biometrik.
        mainHandler.postDelayed({ ensureBackgroundRunningPermission() }, 3_000L)
        // Layar buka kunci biometrik — hanya saat aplikasi benar-benar baru
        // dibuka (bukan rotasi/rekreasi) dan sesi login masih tersimpan.
        maybeShowLockGate(savedInstanceState == null)
    }

    /** DEEP LINK (v1.3.10): path SPA tujuan dari tap notifikasi — disuntikkan
     *  sebagai event "agsi-nav" setelah halaman selesai dimuat. */
    @Volatile
    private var pendingNavPath: String? = null

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val path = navPathFromIntent(intent) ?: return
        if (path.startsWith("http")) {
            // URL penuh (bukan path SPA) → muat langsung
            mainHandler.post { loadSite(path) }
            return
        }
        pendingNavPath = path
        mainHandler.post { loadSite() }
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        PushRegistrar.syncRegistration(this)
        verifyBridgeAlive()
    }

    /** v1.3.25 — penyembuhan jembatan pasca layar terkunci/terbuka: halaman
     *  yang hidup tapi proxy AgsiNative-nya mati membuat SIMPAN STRUK gagal
     *  ("aplikasi perlu dimulai ulang"). Begitu kembali ke depan, panggil satu
     *  metode bridge sinkron (getAppVersion); bila konteks halaman ada tapi
     *  jembatan tidak menjawab → halaman dimuat ulang sekali agar jembatan
     *  terpasang segar — pulih tanpa campur tangan pengguna. Hasil "null"
     *  (konteks belum ada, mis. muat awal) diabaikan — bukan kasus jembatan
     *  mati. */
    private fun verifyBridgeAlive() {
        mainHandler.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            val wv = webView ?: return@postDelayed
            wv.evaluateJavascript(
                "(function(){try{return (typeof window.AgsiNative!=='undefined'&&!(!AgsiNative.getAppVersion)&&String(AgsiNative.getAppVersion()).length>0)?'ok':'bad'}catch(e){return 'bad'}})()"
            ) { r ->
                if (r == "\"bad\"") {
                    Log.w(TAG, "Jembatan mati pasca resume — muat ulang halaman (penyembuhan otomatis)")
                    webView?.reload()
                }
            }
        }, 1200L)
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
        pushReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (_: Exception) {
                // sudah tidak terdaftar
            }
        }
        pushReceiver = null
        screenOffReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (_: Exception) {
                // sudah tidak terdaftar
            }
        }
        screenOffReceiver = null
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
            // Pin GPS lokasi rumah pelanggan (checkout antar) — izin runtime
            // diminta saat halaman memakai navigator.geolocation (ChromeClient)
            setGeolocationEnabled(true)
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

    /** v1.3.21 — JS pembersih service worker & CacheStorage (recreateWebView). */
    private val SW_CLEANUP_JS =
        "(function(){try{if(navigator.serviceWorker)" +
            "navigator.serviceWorker.getRegistrations()" +
            ".then(function(r){r.forEach(function(x){x.unregister()})});" +
            "if(window.caches&&caches.keys)caches.keys()" +
            ".then(function(k){k.forEach(function(x){caches.delete(x)})})}" +
            "catch(e){}})()"

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
        // v1.3.21 — pembersih service worker & CacheStorage di WebView BARU
        // setelah halaman hidup kembali — cegah SW basi menyajikan bundle lama.
        mainHandler.postDelayed({
            webView?.evaluateJavascript(SW_CLEANUP_JS, null)
        }, 2500)
    }

    /** v1.3.21 — diteruskan ke halaman web: token FCM siap/terdaftar →
     *  PushBridge mengikat ulang token ke sesi login (event "agsi-fcm-ready")
     *  — tanpa ini, token yang siap SETELAH login tetap anonim dan push
     *  pesanan staf tidak pernah sampai ke perangkat ini. */
    fun dispatchPushTokenReady() {
        webView?.post {
            webView?.evaluateJavascript(
                "window.dispatchEvent(new Event('agsi-fcm-ready'));",
                null,
            )
        }
    }

    // ==================== Muat halaman & offline ====================

    /** DEEP LINK (v1.3.10): EXTRA_NAV_URL = tap notifikasi lokal
     *  (PushService/NotifPollerService/AgsiNotifications); "url" = data
     *  payload FCM. Mengembalikan PATH SPA mentah (mis. "/orders") — halaman
     *  tujuan dibuka via event "agsi-nav" setelah halaman selesai dimuat
     *  (SPA punya satu route, memuat /orders langsung menghasilkan 404). */
    private fun navPathFromIntent(intent: Intent?): String? {
        return intent?.getStringExtra(EXTRA_NAV_URL)?.trim()?.takeIf { it.isNotEmpty() }
            ?: intent?.getStringExtra("url")?.trim()?.takeIf { it.isNotEmpty() }
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

    /** Terima push dari PushService (aplikasi terbuka) → dispatch event JS
     *  "agsi-push" ke halaman web: popup + suara + segarkan data notifikasi
     *  INSTAN (real-time), tanpa menunggu interval polling halaman. */
    /** v1.3.22 — LAYAR TERKUNCI → APLIKASI LANGSUNG DITUTUP (permintaan
     *  pemilik): begitu layar mati/kunci (ACTION_SCREEN_OFF) aktivitas utama
     *  ditutup habis (finishAndRemoveTask — ikut hilang dari daftar terkini)
     *  sehingga tidak ada yang bisa membuka kunci layar lalu membaca data
     *  penjualan. NOTIFIKASI TETAP BERJALAN: push FCM (PushService) dan
     *  pemantau latar belakang (NotifPollerService) adalah layanan, bukan
     *  aktivitas — kartu status bar tetap muncul walau aplikasi tertutup. */
    private var screenOffReceiver: BroadcastReceiver? = null

    private fun registerScreenLockCloser() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != Intent.ACTION_SCREEN_OFF) return
                Log.i(TAG, "Layar terkunci — aplikasi ditutup otomatis")
                finishAndRemoveTask()
            }
        }
        screenOffReceiver = receiver
        try {
            ContextCompat.registerReceiver(
                this,
                receiver,
                IntentFilter(Intent.ACTION_SCREEN_OFF),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Penutup layar terkunci tidak tersedia", e)
        }
    }

    private fun registerPushForwarder() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != ACTION_PUSH_RECEIVED) return
                val payload = intent.getStringExtra("payload") ?: return
                val wv = peekWebView() ?: return
                wv.post {
                    wv.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('agsi-push',{detail:$payload}));",
                        null,
                    )
                }
            }
        }
        pushReceiver = receiver
        try {
            ContextCompat.registerReceiver(
                this,
                receiver,
                IntentFilter(ACTION_PUSH_RECEIVED),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Penerus push ke halaman tidak tersedia", e)
        }
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

    /** v1.3.35 — tanda alur verifikasi biometrik sedang berjalan. Dua
     *  BiometricPrompt bersamaan (ketukan ganda pada tombol aktifkan) membuat
     *  yang kedua melempar IllegalStateException di sebagian perangkat —
     *  kini ditahan dan dilaporkan sebagai gagal yang jelas. */
    private var biometricFlowActive = false

    /**
     * Alur aktivasi biometrik (dipakai dialog tawaran & Profil → Login
     * Biometrik via jembatan AgsiNative). Verifikasi dulu, baru disimpan.
     */
    fun showBiometricEnableFlow(onSuccess: () -> Unit, onFailure: (String) -> Unit) {
        if (biometricFlowActive) {
            onFailure("verifikasi sedang berjalan")
            return
        }
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
        biometricFlowActive = true
        AppLock.authenticate(
            this,
            title = getString(R.string.biometric_enable_prompt_title),
            subtitle = getString(R.string.biometric_enable_prompt_subtitle),
            negativeText = getString(R.string.biometric_enable_prompt_negative),
        ) { ok, code ->
            biometricFlowActive = false
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
                // v1.3.32 — subfolder "AGSI/" (konsisten dgn struk & laporan
                // dari jembatan saveFile): semua unduhan AGSI kini dalam satu
                // folder Unduhan/AGSI, mudah dicari di aplikasi Files.
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "AGSI/$fileName")
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

    /** v1.3.22 — cbId yang sudah dibalas (IDEMPOTEN): pengawas dialog cetak
     *  tidak boleh mengirim balasan kedua bila dialog ternyata terbuka —
     *  slot callback jembatan tunggal di web akan saling menimpa. */
    private val resolvedBridgeIds = HashSet<String>()

    /** Kirim hasil operasi bridge ke web: window.__agsiNativeResult({id, ok, message})
     *  v1.3.24 — bila WebView belum terpasang (dibuat ulang), balasan DAHULU
     *  dibuang diam-diam (wv?.post) sehingga web menunggu pengawas 3 menit dan
     *  memunculkan "Waktu tunggu penyimpanan habis". Kini dikirim ulang hingga
     *  ±6 detik — pengiriman balasan tidak pernah hilang diam-diam. */
    fun resolveBridge(cbId: String, ok: Boolean, message: String) {
        synchronized(resolvedBridgeIds) {
            if (!resolvedBridgeIds.add(cbId)) return
        }
        val payload = JSONObject().apply {
            put("id", cbId)
            put("ok", ok)
            put("message", message)
        }
        val script = "window.__agsiNativeResult && window.__agsiNativeResult(${payload})"
        deliverBridge(script, 0)
    }

    /** Kirim script balasan ke web; WebView belum siap → ulangi tiap 400 ms
     *  (maks 15×). Tetap aman: resolveBridge idempoten (v1.3.22) menahan
     *  balasan ganda bila percobaan kelewat batas. */
    private fun deliverBridge(script: String, attempt: Int) {
        val wv = peekWebView()
        if (wv == null) {
            if (attempt < 15) {
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                    { deliverBridge(script, attempt + 1) },
                    400L,
                )
            } else {
                Log.w(TAG, "Balasan bridge dibatalkan — WebView tidak tersedia (15 percobaan)")
            }
            return
        }
        wv.post { wv.evaluateJavascript(script, null) }
    }

    /** Tulis bytes PER BAGIAN sambil memperbarui kartu unduhan di status bar
     *  dengan persabagan NYATA (v1.3.30 — permintaan pemilik: unduhan struk
     *  lebih "tajam"): baris progres terisi + "67% · 1,2 MB". Bagian 256 KB,
     *  laporan tiap ≥10% (file kecil: sekali tulis + langsung 100%). */
    private fun writeWithProgress(out: OutputStream, bytes: ByteArray, fileName: String) {
        val chunk = 256 * 1024
        var written = 0
        var lastPct = -100
        do {
            val len = minOf(chunk, bytes.size - written)
            out.write(bytes, written, len)
            written += len
            val pct = if (bytes.isEmpty()) 100 else written * 100 / bytes.size
            if (pct - lastPct >= 10 || written == bytes.size) {
                lastPct = pct
                DownloadNotifier.progress(this, fileName, pct, written.toLong())
            }
        } while (written < bytes.size)
        out.flush()
    }

    /**
     * Simpan file (base64 dari web) ke folder Unduhan.
     *  - Android 10+ : MediaStore Downloads → Unduhan/AGSI, tanpa dialog,
     *    tanpa izin, plus toast konfirmasi.
     *  - Android 8–9 : izin WRITE_EXTERNAL_STORAGE diminta sekali (runtime)
     *    → simpan LANGSUNG ke Unduhan/AGSI; bila izin ditolak → dialog
     *    "Simpan ke" (SAF ACTION_CREATE_DOCUMENT) sebagai fallback.
     */
    fun saveFileToDownloads(cbId: String, base64: String, fileName: String, mimeType: String) {
        val bytes = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (e: Exception) {
            Log.w(TAG, "Base64 dari web tidak valid", e)
            resolveBridge(cbId, false, "data file tidak valid")
            return
        }
        // v1.3.28 — notifikasi unduhan di status bar: kartu "Mengunduh…"
        // langsung tampil (permintaan pemilik), diperbarui jadi "selesai"
        // saat file tertulis.
        DownloadNotifier.progress(this, fileName)
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
                resolver.openOutputStream(uri)?.use { writeWithProgress(it, bytes, fileName) }
                    ?: throw IOException("Tidak bisa membuka output stream")
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                Toast.makeText(this, getString(R.string.file_saved, fileName), Toast.LENGTH_LONG).show()
                // v1.3.28 — kartu "Unduhan selesai ✓" (ketuk → buka file)
                DownloadNotifier.completed(this, fileName, mimeType, uri)
                resolveBridge(cbId, true, fileName)
            } catch (e: Exception) {
                Log.w(TAG, "MediaStore gagal — pakai dialog Simpan-ke (SAF)", e)
                launchSaveFileDialog(cbId, bytes, fileName, mimeType)
            }
        } else {
            // Android 8–9 (API 26–28): butuh izin WRITE_EXTERNAL_STORAGE untuk
            // simpan LANGSUNG ke Unduhan/AGSI. Belum disetujui → minta dulu
            // (payload disimpan sementara di pendingSave*); ditolak → SAF.
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                pendingSaveCbId = cbId
                pendingSaveBytes = bytes
                pendingSaveMime = mimeType
                pendingSaveName = fileName
                storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            } else {
                writeToPublicDownloads(cbId, bytes, fileName, mimeType)
            }
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
     * Simpan LANGSUNG ke Unduhan/AGSI di Android 8–9 — dipanggil setelah izin
     * WRITE_EXTERNAL_STORAGE disetujui (storagePermissionLauncher). Nama file
     * yang sudah ada diberi akhiran (1), (2), … (pola sama dengan MediaStore).
     * Gagal → fallback dialog "Simpan ke" (SAF), pesanan web tetap terjawab.
     */
    private fun writeToPublicDownloads(
        cbId: String,
        bytes: ByteArray,
        fileName: String,
        mimeType: String,
    ) {
        pendingSaveCbId = null
        pendingSaveBytes = null
        pendingSaveMime = null
        pendingSaveName = null
        try {
            @Suppress("DEPRECATION")
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "AGSI"
            )
            if (!dir.exists() && !dir.mkdirs()) {
                throw IOException("Tidak bisa membuat folder Unduhan/AGSI")
            }
            val dot = fileName.lastIndexOf('.')
            val base = if (dot > 0) fileName.substring(0, dot) else fileName
            val ext = if (dot > 0) fileName.substring(dot) else ""
            var target = File(dir, fileName)
            var i = 1
            while (target.exists()) {
                target = File(dir, "$base (${i})$ext")
                i++
            }
            target.outputStream().use { writeWithProgress(it, bytes, target.name) }
            Toast.makeText(this, getString(R.string.file_saved, target.name), Toast.LENGTH_LONG).show()
            // v1.3.32 — DAFTARKAN ke DownloadManager SISTEM: struk & laporan
            // masuk daftar "Unduhan" resmi Android (aplikasi Files/Unduhan) dan
            // sistem menampilkan kartu unduhan selesai di status bar — persis
            // unduhan lewat browser/Chrome. (Android 10+ tidak perlu: MediaStore
            // Downloads sudah otomatis terdaftar di UI Unduhan sistem.)
            registerCompletedDownload(target, mimeType)
            // v1.3.28 — kartu unduhan selesai (tap → buka via FileProvider)
            DownloadNotifier.completed(this, target.name, mimeType, DownloadNotifier.fileProviderUri(this, target))
            resolveBridge(cbId, true, target.name)
        } catch (e: Exception) {
            Log.w(TAG, "Simpan langsung Unduhan gagal — pakai dialog Simpan-ke (SAF)", e)
            launchSaveFileDialog(cbId, bytes, fileName, mimeType)
        }
    }

    /**
     * v1.3.32 — registrasi file yang sudah ditulis ke DownloadManager SISTEM
     * (DownloadManager.addCompletedDownload — API resmi Android untuk
     * mendaftarkan file hasil unduhan manual): file tampil di daftar Unduhan
     * sistem dan bila showNotification=true sistem ikut menampilkan kartu
     * "Unduhan selesai" di status bar.
     *
     * Hanya untuk Android 8–9 (jalur File langsung Unduhan/AGSI); di Android
     * 10+ file tersimpan via MediaStore.Downloads yang sudah otomatis tampak
     * di aplikasi Unduhan, dan addCompletedDownload dengan path MediaStore
     * memang tidak sah (IllegalArgumentException) — dilewati.
     * Gagal registrasi BUKAN kegagalan simpan: file tetap ada di Unduhan/AGSI.
     */
    private fun registerCompletedDownload(file: File, mimeType: String) {
        try {
            @Suppress("DEPRECATION")
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.addCompletedDownload(
                file.name,
                "AGSI — struk & laporan", // deskripsi kartu unduhan sistem
                true, // tampil di UI Unduhan (aplikasi Files / Unduhan)
                mimeType,
                file.absolutePath,
                file.length(),
                true, // sistem menampilkan notifikasi unduhan selesai di status bar
            )
        } catch (e: Exception) {
            Log.w(TAG, "Registrasi DownloadManager sistem gagal — file tetap tersimpan", e)
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
        // v1.3.22 — pengawas: bila dialog cetak TIDAK terbuka dalam 12 dtk
        // (spooler cetak nonaktif/beku di beberapa OEM), halaman tetap menerima
        // balasan penjelasan — dulu diam sampai batas waktu web (15 dtk) dan
        // pengguna hanya melihat "Dialog Cetak Gagal" tanpa tahu sebabnya.
        mainHandler.postDelayed({
            resolveBridge(
                cbId,
                false,
                "Dialog cetak tidak terbuka. Aktifkan 'Cetak' di Pengaturan ▸ Aplikasi ▸ Tampilkan aplikasi sistem, atau pasang plugin printer Anda.",
            )
        }, 12_000)
        try {
            val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
            val job = printManager.print(title, wv.createPrintDocumentAdapter(title), PrintAttributes.Builder().build())
            if (job == null) {
                resolveBridge(cbId, false, "Layanan cetak sistem tidak merespons. Periksa layanan cetak di Pengaturan.")
                return
            }
            resolveBridge(cbId, true, "dialog cetak dibuka")
        } catch (e: Exception) {
            Log.w(TAG, "Gagal membuka dialog cetak", e)
            resolveBridge(cbId, false, "Perangkat tidak dapat membuka dialog cetak: ${e.message ?: "tidak diketahui"}")
        }
    }

    /**
     * CETAK FILE PDF via printer sistem Android (v1.3.28 — permintaan pemilik:
     * "gunakan printer sistem android untuk cetak struk dan laporan").
     *
     * Berbeda dari printPage() yang mencetak HALAMAN WEB dengan aturan @media
     * print, metode ini mencetak FILE PDF sungguhan (hasil buildStrukPdf /
     * dokumen laporan) lewat PdfPrintAdapter — dialog cetak sistem menawarkan
     * semua printer terpasang (thermal 58/80 mm, Bluetooth, jaringan) plus
     * "Simpan sebagai PDF". PDF sementara ditulis di cache app lalu diserahkan
     * ke spooler. Hasil via resolveBridge (pengawas 12 dtk seperti printPage).
     */
    fun printPdfFile(cbId: String, base64: String, fileName: String) {
        val bytes = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (e: Exception) {
            Log.w(TAG, "Base64 PDF dari web tidak valid", e)
            resolveBridge(cbId, false, "data PDF tidak valid")
            return
        }
        // v1.3.37 — penjaga jawaban tunggal: pengawas 12 dtk lama bisa
        // menjawab "gagal" SETELAH jawaban sukses terkirim (dua jawaban
        // satu cbId — web sudah lanjut). Kini hanya jalur PERTAMA yang dijawab.
        var answered = false
        fun done(ok: Boolean, message: String) {
            if (answered) return
            answered = true
            resolveBridge(cbId, ok, message)
        }
        // v1.3.37 — deteksi dini layanan cetak dimatikan ROM (OPPO/realme/
        // MIUI mematikan "Print Spooler" bawaan): print() TETAP mengembalikan
        // job tapi dialog TIDAK PERNAH tampil — laporan pemilik "dialog
        // printer tidak muncul". Bila nonaktif: halaman "Aktifkan" spooler
        // langsung dibuka + jawaban sebab spesifik (bukan "sukses" palsu).
        if (printSpoolerDisabled()) {
            openPrintSpoolerSettings()
            done(
                false,
                "LAYANAN_CETAK_NONAKTIF|Layanan cetak Android (Print Spooler) nonaktif di HP ini — halaman pengaturannya sudah dibuka: tekan 'Aktifkan', kembali ke AGSI, lalu tekan Cetak lagi.",
            )
            return
        }
        val watchdog = Runnable {
            done(
                false,
                "Dialog cetak tidak terbuka. Aktifkan 'Cetak' di Pengaturan ▸ Aplikasi ▸ Tampilkan aplikasi sistem, atau pasang plugin printer Anda.",
            )
        }
        mainHandler.postDelayed(watchdog, 12_000)
        try {
            val dir = File(cacheDir, "print").apply { mkdirs() }
            val pdf = File(dir, fileName.ifBlank { "agsi-dokumen.pdf" })
            pdf.outputStream().use { it.write(bytes) }
            val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
            val job = printManager.print(
                fileName.substringBeforeLast('.').ifBlank { "AGSI Dokumen" },
                PdfPrintAdapter(pdf, fileName),
                PrintAttributes.Builder().build(),
            )
            mainHandler.removeCallbacks(watchdog)
            if (job == null) {
                openPrintSpoolerSettings()
                done(
                    false,
                    "LAYANAN_CETAK_NONAKTIF|Layanan cetak sistem tidak merespons — halaman pengaturan cetak dibuka; aktifkan layanan cetak lalu tekan Cetak lagi.",
                )
                return
            }
            done(true, "dialog cetak dibuka")
        } catch (e: Exception) {
            Log.w(TAG, "Gagal menyiapkan cetak PDF", e)
            mainHandler.removeCallbacks(watchdog)
            done(false, "Gagal menyiapkan cetak: ${e.message ?: "tidak diketahui"}")
        }
    }

    /** v1.3.37 — apakah layanan cetak sistem (Print Spooler) dinonaktifkan?
     *  ROM OPPO/realme/MIUI sering mematikannya bawaan → dialog cetak tidak
     *  pernah tampil walau print() sukses. Paket tidak ada di ROM (nama lain)
     *  = tidak diketahui → false (biarkan print() mencoba). */
    private fun printSpoolerDisabled(): Boolean {
        for (pkg in listOf("com.android.printspooler", "com.android.print.spooler")) {
            try {
                val st = packageManager.getApplicationEnabledSetting(pkg)
                if (st == PackageManager.COMPONENT_ENABLED_STATE_DISABLED ||
                    st == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER
                ) return true
            } catch (_: Exception) {
                // paket tidak ditemukan di ROM ini — coba kandidat berikutnya
            }
        }
        return false
    }

    /** v1.3.37 — buka halaman untuk MENGAKTIFKAN layanan cetak, urut
     *  tercepat: 1) detail aplikasi Print Spooler (satu ketuk "Aktifkan"),
     *  2) halaman Pengaturan ▸ Cetak sistem, 3) toast panduan. */
    fun openPrintSpoolerSettings() {
        val candidates = mutableListOf<Intent>()
        for (pkg in listOf("com.android.printspooler", "com.android.print.spooler")) {
            try {
                packageManager.getPackageInfo(pkg, 0)
                candidates += Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:$pkg"))
            } catch (_: Exception) {
                // paket tidak ada di ROM ini
            }
        }
        candidates += Intent("android.settings.ACTION_PRINT_SETTINGS")
        for (intent in candidates) {
            try {
                startActivity(intent)
                return
            } catch (_: Exception) {
                // layar tidak tersedia — coba kandidat berikutnya
            }
        }
        Toast.makeText(
            this,
            "Aktifkan 'Print Spooler' di Pengaturan ▸ Aplikasi ▸ Tampilkan aplikasi sistem",
            Toast.LENGTH_LONG,
        ).show()
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

    /**
     * Minta izin notifikasi secara AKTIF agar notifikasi tampil MAKSIMAL:
     *  - Android 13+ (API 33): izin runtime POST_NOTIFICATIONS WAJIB diminta —
     *    tanpa ini notifikasi BISU total walau channel & FCM benar. Dialog
     *    sistem diminta SETIAP aplikasi dibuka selama belum disetujui; bila
     *    user menolak permanen, hasil "ditolak" kembali instan → jebakan
     *    pengingat via notifPermissionLauncher (popup + pintasan setelan).
     *  - Semua versi: bila notifikasi dimatikan lewat setelan sistem
     *    (Pengaturan ▸ Aplikasi ▸ AGSI ▸ Notifikasi), tampilkan penjelasan
     *    + pintasan langsung ke setelan notifikasi aplikasi.
     */
    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        // Izin runtime sudah OK (atau < Android 13) — cek saklar notifikasi
        // di setelan sistem yang bisa dimatikan user kapan saja. Ditunda
        // sedetik agar tidak berebut dengan gate kunci biometrik saat start.
        mainHandler.postDelayed(
            {
                val nm = getSystemService(NotificationManager::class.java)
                if (nm != null && !nm.areNotificationsEnabled()) maybeShowNotifNudge()
            },
            1200L
        )
    }

    /** Popup penjelasan "kenapa notifikasi penting" + tombol pintasan ke
     *  setelan notifikasi aplikasi — dibatasi 1× per 24 jam (SharedPreferences)
     *  agar tidak mengganggu, tetapi terus mengingatkan selama belum aktif. */
    private fun maybeShowNotifNudge() {
        val prefs = getSharedPreferences("agsi_prefs", Context.MODE_PRIVATE)
        val last = prefs.getLong("notif_nudge_at", 0L)
        if (System.currentTimeMillis() - last < 24 * 60 * 60 * 1000L) return
        prefs.edit().putLong("notif_nudge_at", System.currentTimeMillis()).apply()
        AlertDialog.Builder(this)
            .setTitle(R.string.notif_perm_title)
            .setMessage(R.string.notif_perm_message)
            .setPositiveButton(R.string.notif_perm_open_settings) { _, _ ->
                openAppNotificationSettings()
            }
            .setNegativeButton(R.string.notif_perm_later, null)
            .show()
    }

    /** Izin notifikasi DITOLAK pengguna (v1.3.8 — permintaan pemilik: izin
     *  langsung ke pengaturan). Penolakan PERTAMA → popup penjelasan instan
     *  (tanpa menunggu 24 jam) + tombol pintasan setelan; penolakan KEDUA
     *  dst → LANGSUNG buka setelan notifikasi aplikasi (dibatasi 1×/24 jam
     *  agar tidak mengganggu). */
    private fun onNotifPermissionDenied() {
        val prefs = getSharedPreferences("agsi_prefs", Context.MODE_PRIVATE)
        val denials = prefs.getInt("notif_denied_count", 0) + 1
        prefs.edit().putInt("notif_denied_count", denials).apply()
        if (denials >= 2) {
            openAppNotificationSettings(minIntervalMs = 24 * 60 * 60 * 1000L)
        } else {
            maybeShowNotifNudge()
        }
    }

    /** Buka setelan notifikasi aplikasi (Pengaturan ▸ Aplikasi ▸ AGSI ▸
     *  Notifikasi). minIntervalMs membatasi frekuensi lompatan OTOMATIS
     *  (default 0 = selalu buka — dipakai tombol manual di popup). */
    private fun openAppNotificationSettings(minIntervalMs: Long = 0L) {
        val prefs = getSharedPreferences("agsi_prefs", Context.MODE_PRIVATE)
        val last = prefs.getLong("notif_settings_at", 0L)
        if (minIntervalMs > 0 && System.currentTimeMillis() - last < minIntervalMs) return
        prefs.edit().putLong("notif_settings_at", System.currentTimeMillis()).apply()
        try {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            )
        } catch (e: ActivityNotFoundException) {
            // Fallback: layar detail aplikasi (saklar notifikasi ada di sana)
            try {
                startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:$packageName"))
                )
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Dialog sistem "izinkan AGSI mengabaikan optimasi baterai" TANPA jeda —
     * dipakai tombol "Izinkan Baterai" di Pengaturan Notifikasi (v1.3.12,
     * lewat jembatan web). Versi otomatis (ensureBackgroundRunningPermission)
     * tetap berjeda 3 hari agar tidak mengganggu; tombol manual ini harus
     * selalu merespons seketika.
     */
    fun openBatteryExemptionRequest() {
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:$packageName"))
            )
        } catch (e: ActivityNotFoundException) {
            // Fallback: daftar aplikasi yang boleh mengabaikan hemat baterai
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (_: Exception) {
            }
        }
    }

    /**
     * PINTASAN AUTOSTART OEM (v1.3.12): layar "Autostart"/"Startup" milik
     * pabrikan (Xiaomi MIUI, OPPO/realme ColorOS, vivo FuntouchOS, Huawei/
     * Honor EMUI) — di ROM tersebut layanan notifikasi latar belakang
     * DIMATIKAN sistem sampai aplikasi diizinkan Autostart, walau optimasi
     * baterai sudah dikecualikan. Komponen dicoba satu per satu (tidak ada
     * di ROM → kandidat berikutnya); pabrikan lain (mis. Samsung) → layar
     * detail aplikasi yang memuat saklar baterai & izin.
     */
    fun openAutostartSettings() {
        val candidates = listOf(
            // Xiaomi MIUI / HyperOS
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            // OPPO ColorOS / realme UI
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
            // vivo FuntouchOS
            ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            // Huawei / Honor EMUI
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
            ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
        )
        for (cn in candidates) {
            try {
                startActivity(Intent().setComponent(cn).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (_: Exception) {
                // komponen tak ada di ROM ini — coba kandidat berikutnya
            }
        }
        try {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:$packageName"))
            )
        } catch (_: Exception) {
        }
    }

    /**
     * Izin BERJALAN DI LATAR BELAKANG (v1.3.9 — permintaan pemilik: minta
     * izin dari HP langsung).
     * v1.3.26 — dialog SISTEM "izinkan AGSI mengabaikan optimasi baterai"
     * memuat 3 paragraf penjelasan panjang; teksnya digambar OS sehingga tak
     * bisa dipendekkan dari aplikasi (permintaan pemilik: "tanpa teks lain").
     * Karena itu dialog milik aplikasi menggantikannya: SATU kalimat +
     * TOLAK/IZINKAN. IZINKAN → langsung halaman baterai aplikasi di Setelan
     * (pilih "Tidak dibatasi" sekali — tanpa dialog OS panjang lagi).
     * Ulang tiap 3 hari selama belum disetujui, berhenti setelah disetujui.
     */
    private fun ensureBackgroundRunningPermission() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        val prefs = getSharedPreferences("agsi_prefs", Context.MODE_PRIVATE)
        val last = prefs.getLong("battery_asked_at", 0L)
        if (System.currentTimeMillis() - last < 3 * 24 * 60 * 60 * 1000L) return
        prefs.edit().putLong("battery_asked_at", System.currentTimeMillis()).apply()
        AlertDialog.Builder(this)
            .setTitle(R.string.battery_dialog_title)
            .setPositiveButton(R.string.battery_btn_allow) { _, _ ->
                Toast.makeText(this, R.string.battery_toast_hint, Toast.LENGTH_LONG).show()
                try {
                    startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                            .setData(Uri.parse("package:$packageName"))
                    )
                } catch (_: Exception) {
                    // Fallback: daftar aplikasi yang boleh mengabaikan hemat baterai
                    try {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    } catch (_: Exception) {
                    }
                }
            }
            .setNegativeButton(R.string.battery_btn_deny, null)
            .show()
    }

    // ==================== Util ====================

    /**
     * BAGIKAN FILE dari web (v1.3.27): PDF struk ditulis ke cache aplikasi
     * (agsi-share) lalu dibagikan lewat ACTION_SEND + FileProvider — jalur
     * FALLBACK ANTI-GAGAL untuk saveFileToDownloads: tak menyentuh penyimpanan
     * Unduhan, jadi kebal galat izin/MediaStore/SAF. Pemilik meneruskan ke
     * WhatsApp, aplikasi printer, atau PDF viewer. Gagal → resolveBridge
     * (false) agar web bisa menampilkan pesan.
     */
    fun shareFileFromCache(cbId: String, base64: String, fileName: String, mimeType: String) {
        val bytes = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (e: Exception) {
            Log.w(TAG, "Base64 bagikan tidak valid", e)
            resolveBridge(cbId, false, "data file tidak valid")
            return
        }
        try {
            val dir = File(cacheDir, "agsi-share").apply { mkdirs() }
            // Cache kecil — bersihkan sisa share sebelumnya agar tak menumpuk.
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, fileName.ifBlank { "agsi-file" })
            FileOutputStream(file).use { it.write(bytes) }
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeType.ifBlank { "application/octet-stream" }
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, getString(R.string.share_receipt_title))
                // ClipData + flag: izin baca URI diberikan ke semua aplikasi
                // penerima dalam chooser (pola resmi Android).
                clipData = ClipData.newRawUri(file.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(send, getString(R.string.share_receipt_title)))
            resolveBridge(cbId, true, fileName)
        } catch (e: Exception) {
            Log.w(TAG, "Bagikan file gagal", e)
            resolveBridge(cbId, false, "perangkat tidak menyediakan lembar bagikan")
        }
    }

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
            // DEEP LINK NOTIFIKASI (v1.3.10): suntikkan event "agsi-nav" ke
            // SPA — AppShell memetakan path ("/orders" → view pesanan,
            // "/chat" → buka chat CS). Dikirim dua kali (segera + setelah SPA
            // terhidrasi) agar sampai walau render lambat.
            pendingNavPath?.let { path ->
                pendingNavPath = null
                val safe = path.replace("\\", "\\\\").replace("\"", "\\\"")
                val script =
                    "window.dispatchEvent(new CustomEvent('agsi-nav',{detail:\"$safe\"}))"
                view?.evaluateJavascript(script, null)
                mainHandler.postDelayed({ view?.evaluateJavascript(script, null) }, 900)
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
            // Pin GPS lokasi rumah pelanggan (checkout antar — kurir antar
            // presisi). Sudah diizinkan → langsung beri; belum → minta izin
            // runtime ACCESS_FINE_LOCATION, balasan dialog diteruskan ke web.
            if (origin == null || callback == null) return
            val granted =
                ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.ACCESS_FINE_LOCATION
                ) ==
                    PackageManager.PERMISSION_GRANTED
            if (granted) {
                callback.invoke(origin, true, false)
            } else {
                pendingGeoOrigin = origin
                pendingGeoCallback = callback
                locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }

        override fun onGeolocationPermissionsHidePrompt() {
            // Dialog ditutup tanpa jawaban — buang callback yang menunggu
            pendingGeoOrigin = null
            pendingGeoCallback = null
        }
    }
}
