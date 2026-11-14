package com.agsi.app

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * NotifPollerService — PENGANTAR NOTIFIKASI DI LUAR APLIKASI (tanpa FCM).
 *
 * Latar belakang: push FCM sudah tersambung penuh di sisi aplikasi
 * (PushService + PushRegistrar), tetapi pengiriman butuh kredensial Firebase
 * di server (.env FIREBASE_* + google-services.json). Agar notifikasi pesanan
 * baru / update status / chat CS TETAP muncul sebagai notifikasi layar walau
 * aplikasi ditutup, layanan ini memantau API AGSI secara berkala:
 *
 *   GET /api/orders?scope=all   (cookie sesi web — sama dengan halaman)
 *   GET /api/chat/unread
 *   GET /api/auth/me            (sekali — menentukan copy staff / pelanggan)
 *   GET /api/push/config        (tiap ±30 putaran — bila FCM aktif di server,
 *                                notifikasi lokal otomatis dipadamkan supaya
 *                                tidak dobel dengan push FCM)
 *
 * Cara kerja:
 *  - Foreground service (tipe specialUse) dengan notifikasi TERSEMBUNYI
 *    (v1.3.1: channel IMPORTANCE_NONE — tidak pernah tampil di status bar /
 *    daftar notifikasi) supaya Android mengizinkan polling jangka panjang
 *    (START_STICKY, dijalankan ulang saat boot oleh BootReceiver).
 *  - Hanya memantau saat aplikasi DI LATAR BELAKANG; saat aplikasi tampil di
 *    depan, popup + suara di halaman web (NotifWatchers) yang bekerja —
 *    siklus pertama setelah kembali ke latar belakang dipakai sebagai
 *    BASELINE (menandai kondisi terkini, tanpa notifikasi) agar tidak ada
 *    notifikasi ganda untuk kejadian yang sudah terlihat pengguna.
 *  - Perubahan terdeteksi dengan membandingkan status pesanan & hitungan chat
 *    terhadap kondisi terakhir yang tersimpan di SharedPreferences, jadi
 *    proses dibunuh/direstart pun tidak memunculkan notifikasi lama.
 *  - Sesi login habis (401) → polling melambat (backoff 5 menit) sampai
 *    pengguna membuka aplikasi & login lagi.
 *
 * Bisa dimatikan dari Profil → Notifikasi Push → "Notifikasi Latar Belakang"
 * (jembatan AgsiNative.setNotifPolling).
 */
class NotifPollerService : Service() {

    companion object {
        private const val TAG = "AGSI/Poll"
        private const val PREFS = "agsi_notif"
        private const val KEY_ENABLED = "notif_enabled"
        private const val KEY_BATTERY_ASKED = "battery_asked"
        private const val KEY_ROLE = "poll_role"
        private const val KEY_SEEN = "seen_orders"
        private const val KEY_STATE = "order_state"
        private const val KEY_CHAT = "chat_unread"
        private const val KEY_FCM_ACTIVE = "fcm_active"
        private const val KEY_FCM_CHECKED_AT = "fcm_checked_at"

        private const val NOTIF_SERVICE_ID = 42001

        /** Interval polling normal — seimbang untuk baterai & kecepatan kabar */
        private const val POLL_MS = 45_000L
        /** Backoff saat sesi tidak valid (401) — hindari permintaan sia-sia */
        private const val BACKOFF_MS = 5 * 60_000L
        /** Jendela "pesanan benar-benar baru" — sinkron dengan web (3 menit) */
        private const val FRESH_MS = 3 * 60_000L
        /** Batas jumlah id pesanan yang diingat (anti membesar tanpa batas) */
        private const val CAP = 250
        /** Cek /api/push/config tiap N putaran (deteksi FCM aktif di server) */
        private const val FCM_CHECK_EVERY = 30

        private const val SESSION_PREFIX = "agsi_session="

        fun isEnabled(ctx: Context): Boolean =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)

        /** Saklar dari web (jembatan AgsiNative.setNotifPolling) */
        fun setEnabled(ctx: Context, on: Boolean) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_ENABLED, on).apply()
            if (on) start(ctx) else stop(ctx)
        }

        fun startIfEnabled(ctx: Context) {
            if (!isEnabled(ctx)) return
            val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            // Push FCM kini mekanisme UTAMA. Bila pemeriksaan terakhir
            // menyatakan FCM aktif di server DAN perangkat punya token FCM,
            // layanan pemantau tidak perlu jalan (tanpa notifikasi layanan,
            // tanpa polling) — hemat baterai. Cek ulang tiap 6 jam agar bila
            // FCM di server dimatikan, pemantau bangun lagi sendiri.
            val fcmActive = prefs.getBoolean(KEY_FCM_ACTIVE, false)
            if (fcmActive && PushRegistrar.cachedToken(ctx).isNotBlank()) {
                val last = prefs.getLong(KEY_FCM_CHECKED_AT, 0L)
                if (System.currentTimeMillis() - last < 6 * 60 * 60_000L) return
            }
            start(ctx)
        }

        fun start(ctx: Context) {
            try {
                ContextCompat.startForegroundService(
                    ctx, Intent(ctx, NotifPollerService::class.java)
                )
            } catch (e: Exception) {
                Log.w(TAG, "Gagal memulai layanan notifikasi", e)
            }
        }

        fun stop(ctx: Context) {
            try {
                ctx.stopService(Intent(ctx, NotifPollerService::class.java))
            } catch (_: Exception) {
                // memang tidak berjalan
            }
        }
    }

    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var stopped = false

    /** Siklus pertama setelah kembali ke latar belakang = baseline (diam) */
    @Volatile
    private var wasForeground = true

    private var pollCount = 0

    private val tick = object : Runnable {
        override fun run() {
            if (stopped) return
            handler.postDelayed(this, POLL_MS)
            executor.execute { safePoll() }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundCompat()
        maybeRequestBatteryExemption()
        stopped = false
        wasForeground = true
        handler.postDelayed(tick, 4_000)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        handler.removeCallbacks(tick)
        super.onDestroy()
    }

    // ==================== Inti polling ====================

    private fun safePoll() {
        try {
            poll()
        } catch (e: Exception) {
            Log.w(TAG, "Siklus pemantauan gagal", e)
        }
    }

    private fun poll() {
        if (stopped) return

        // Aplikasi tampil di depan → halaman web yang menangani (popup + suara)
        if (AgsiApp.isForeground) {
            wasForeground = true
            return
        }
        val baseline = wasForeground
        wasForeground = false
        pollCount++

        val cookie = CookieManager.getInstance().getCookie(SiteConfig.BASE_URL + "/") ?: ""
        if (!hasSession(cookie)) return // belum login — tunggu dengan tenang

        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        // ---- FCM aktif di server? → push FCM yang bekerja; kalau perangkat
        // punya token, layanan pemantau HENTIKAN DIRI (tidak ada notifikasi
        // ganda, tanpa notifikasi "layanan berjalan", hemat baterai). Bila
        // FCM aktif di server tapi perangkat TIDAK punya token (GMS hilang),
        // pemantau tetap jalan sebagai penyelamat notifikasi.
        if (pollCount % FCM_CHECK_EVERY == 1) {
            val (_, cfg) = getJson("/api/push/config", cookie)
            val active = cfg?.optBoolean("configured", false) == true
            prefs.edit()
                .putBoolean(KEY_FCM_ACTIVE, active)
                .putLong(KEY_FCM_CHECKED_AT, System.currentTimeMillis())
                .apply()
            if (active && PushRegistrar.cachedToken(this).isNotBlank()) {
                Log.i(TAG, "FCM aktif di server & token perangkat tersedia — layanan pemantau berhenti")
                stopped = true
                handler.removeCallbacks(tick)
                stopSelf()
                return
            }
            if (active) Log.i(TAG, "FCM aktif di server — notifikasi lokal dipadamkan (token kosong, pemantau lanjut)")
        }
        val fcmActive = prefs.getBoolean(KEY_FCM_ACTIVE, false)

        // ---- Peran (staff / pelanggan) — menentukan salinan notifikasi ----
        var role = prefs.getString(KEY_ROLE, "") ?: ""
        if (role.isBlank() || pollCount % 40 == 0) {
            val (meCode, me) = getJson("/api/auth/me", cookie)
            if (meCode == 401) return backoffAuth()
            val r = me?.optJSONObject("user")?.optString("role", "") ?: ""
            if (r.isBlank()) return
            role = if (r == "ADMIN" || r == "OWNER" || r == "CASHIER") "staff" else "customer"
            prefs.edit().putString(KEY_ROLE, role).apply()
        }

        // ---- Pesanan ----
        val (code, ordersJson) = getJson("/api/orders?scope=all", cookie)
        if (code == 401) return backoffAuth()
        if (code in 200..299 && ordersJson != null) {
            val events = diffOrders(ordersJson, role, baseline, fcmActive)

            // ---- Chat belum dibaca ----
            val (chatCode, chatJson) = getJson("/api/chat/unread", cookie)
            if (chatCode in 200..299 && chatJson != null) {
                val unread = chatJson.optInt("unread", 0)
                val prev = prefs.getInt(KEY_CHAT, 0)
                if (!baseline && !fcmActive && unread > prev) {
                    val staff = role == "staff"
                    events.add(
                        Event(
                            tag = "chat",
                            title = if (staff) "💬 Chat Pelanggan Baru!" else "💬 Pesan Baru dari CS",
                            body =
                                if (unread > 1)
                                    if (staff) "$unread pesan pelanggan menunggumu di daftar chat CS."
                                    else "$unread balasan baru dari CS AGSI menunggumu di chat."
                                else
                                    if (staff) "Seorang pelanggan baru mengirim pesan — segera dibalas ya!"
                                    else "CS AGSI membalas pesanmu — cek sekarang ya!",
                            url = "/",
                            channel = AgsiApp.CHANNEL_CHAT,
                        )
                    )
                }
                prefs.edit().putInt(KEY_CHAT, unread).apply()
            }

            for (ev in events) notifyEvent(ev)
        }
    }

    private fun backoffAuth() {
        Log.i(TAG, "Sesi tidak valid — polling melambat sementara")
        // cukup lewatkan siklus ini; interval tetap 45 dtk (murah: 2 GET kecil),
        // tapi hentikan kirim notifikasi sampai ada data valid
    }

    /** Bandingkan daftar pesanan dengan kondisi terakhir → daftar notifikasi */
    private fun diffOrders(
        ordersJson: JSONObject,
        role: String,
        baseline: Boolean,
        fcmActive: Boolean,
    ): MutableList<Event> {
        val events = mutableListOf<Event>()
        val arr = ordersJson.optJSONArray("orders") ?: return events
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val prevState = JSONObject(prefs.getString(KEY_STATE, "{}") ?: "{}")
        val now = System.currentTimeMillis()
        val newSeen = JSONObject()
        val newState = JSONObject()

        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optString("id")
            if (id.isBlank()) continue
            val status = o.optString("status", "")
            val pay = o.optString("paymentStatus", "")
            val createdAt = parseMs(o.optString("createdAt", ""))
            newSeen.put(id, if (createdAt > 0) createdAt else now)
            newState.put(id, "$status|$pay")

            val prevPair = prevState.optString(id, "")
            if (prevPair.isEmpty()) {
                // Belum pernah terlihat poller → pesanan baru?
                // Hanya staff yang diberi tahu pesanan baru (pelanggan sendiri
                // yang membuatnya); jendela 3 menit + bukan baseline + FCM mati.
                if (role == "staff" && !baseline && !fcmActive &&
                    status != "CANCELLED" && createdAt > 0 && now - createdAt <= FRESH_MS
                ) {
                    events.add(
                        Event(
                            tag = "order-$id",
                            title = "🔔 Pesanan Baru Masuk!",
                            body = copyNewOrder(o),
                            url = "/orders",
                            channel = AgsiApp.CHANNEL_ORDERS,
                        )
                    )
                }
            } else {
                val prevStatus = prevPair.substringBefore("|")
                val prevPay = prevPair.substringAfter("|", "UNPAID")
                if (!baseline && !fcmActive) {
                    if (prevPay != "PAID" && pay == "PAID") {
                        if (role == "staff") {
                            events.add(
                                Event(
                                    tag = "order-$id",
                                    title = "💰 QRIS Terbayar — Masuk Dapur!",
                                    body = "${o.optString("code", "")} • ${formatRp(o.optLong("total", 0))}\n${ringkasItems(o)}",
                                    url = "/orders",
                                    channel = AgsiApp.CHANNEL_ORDERS,
                                )
                            )
                        } else {
                            events.add(
                                Event(
                                    tag = "order-$id",
                                    title = "💳 Pembayaran Diterima!",
                                    body = "Dana pesanan ${o.optString("code", "")} sudah masuk. Pesanan otomatis lanjut ke dapur — pantau di menu Pesanan ya!",
                                    url = "/orders",
                                    channel = AgsiApp.CHANNEL_ORDERS,
                                )
                            )
                        }
                    } else if (role == "customer" && prevStatus != status) {
                        statusCopy(o, status)?.let { events.add(it) }
                    }
                }
            }
        }

        prefs.edit()
            .putString(KEY_SEEN, pruneSeen(newSeen))
            .putString(KEY_STATE, capJson(newState))
            .apply()
        return events
    }

    /** Salinan notifikasi perubahan status untuk pelanggan — sama dengan web */
    private fun statusCopy(o: JSONObject, status: String): Event? {
        val code = o.optString("code", "")
        val (title, body) = when (status) {
            "PREPARING" -> "👨‍🍳 Pesanan Sedang Dimasak" to
                "Pesanannya $code sedang digeprek chef! Sambal ijo disiapkan segar ya 🌶️"
            "READY" -> "🔔 Pesanan Siap!" to
                "$code sudah SIAP — silakan diambil / dinikmati. Selamat makan!"
            "COMPLETED" -> "🎉 Pesanan Selesai" to
                "Pesanan $code selesai. Terima kasih sudah makan di AGSI — poin member juga sudah masuk!"
            "CANCELLED" -> "Pesanan Dibatalkan" to
                "Pesanan $code dibatalkan. Bila merasa keliru, hubungi CS lewat menu Chat ya."
            else -> return null
        }
        return Event(
            tag = "order-${o.optString("id", "")}",
            title = title,
            body = body,
            url = "/orders",
            channel = AgsiApp.CHANNEL_ORDERS,
        )
    }

    private fun copyNewOrder(o: JSONObject): String {
        val lokasi = when {
            o.optString("tableNo", "").isNotBlank() -> " • Meja ${o.optString("tableNo")}"
            o.optString("type") == "TAKEAWAY" -> " • Bungkus"
            o.optString("type") == "DELIVERY" -> " • Antar"
            else -> ""
        }
        return "${o.optString("code", "")}$lokasi • ${formatRp(o.optLong("total", 0))}\n${ringkasItems(o)}"
    }

    private fun ringkasItems(o: JSONObject): String {
        val arr = o.optJSONArray("items") ?: return ""
        val sb = StringBuilder()
        for (i in 0 until arr.length()) {
            val it = arr.optJSONObject(i) ?: continue
            if (sb.isNotEmpty()) sb.append(" • ")
            sb.append(it.optString("name", "")).append(" ×").append(it.optInt("qty", 1))
        }
        val s = sb.toString()
        return if (s.length > 140) s.take(137) + "…" else s
    }

    private fun formatRp(value: Long): String {
        val nf = java.text.NumberFormat.getIntegerInstance(Locale("in", "ID"))
        return "Rp${nf.format(value)}"
    }

    // ==================== Notifikasi ====================

    private data class Event(val tag: String, val title: String, val body: String, val url: String, val channel: String)

    private fun notifyEvent(ev: Event) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return

        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
            putExtra(MainActivity.EXTRA_NAV_URL, ev.url)
        }
        val pending = PendingIntent.getActivity(
            this,
            ev.url.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, ev.channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(ev.title)
            .setContentText(ev.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(ev.body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // 🔒 Tampil PENUH di layar kunci + ⏰ bangunkan layar HP yang tidur
            // (full-screen intent — perilaku sama dengan jalur FCM PushService)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(pending, true)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        try {
            NotificationManagerCompat.from(this).notify(ev.tag, ev.title.hashCode(), notification)
        } catch (_: SecurityException) {
            // izin dicabut pengguna — abaikan
        }
    }

    /** Notifikasi layanan — TERSEMBUNYI (channel IMPORTANCE_NONE + SECRET):
     *  wajib di-post utk foreground service, tapi tidak pernah tampil. */
    private fun buildServiceNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(MainActivity.EXTRA_NAV_URL, "/")
        }
        val pending = PendingIntent.getActivity(
            this,
            1,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, AgsiApp.CHANNEL_SERVICE_HIDDEN)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notif_service_title))
            .setContentText(getString(R.string.notif_service_text))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(false)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setContentIntent(pending)
            .build()
    }

    private fun startForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIF_SERVICE_ID,
                buildServiceNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIF_SERVICE_ID, buildServiceNotification())
        }
    }

    /** Sekali seumur hidup: minta pengecualian hemat baterai agar polling
     *  tidak ditunda Doze (dialog sistem; hanya saat aplikasi di depan).
     *  Tidak diminta bila FCM aktif — pemantau akan berhenti sendiri. */
    private fun maybeRequestBatteryExemption() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_BATTERY_ASKED, false)) return
        if (prefs.getBoolean(KEY_FCM_ACTIVE, false) &&
            PushRegistrar.cachedToken(this).isNotBlank()
        ) return
        if (!AgsiApp.isForeground) return
        prefs.edit().putBoolean(KEY_BATTERY_ASKED, true).apply()
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:$packageName"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) {
            Log.w(TAG, "Dialog pengecualian baterai tidak tersedia", e)
        }
    }

    // ==================== Util ====================

    private fun hasSession(cookie: String): Boolean =
        cookie.split(";").any {
            val p = it.trim()
            p.startsWith(SESSION_PREFIX) && p.length > SESSION_PREFIX.length
        }

    /** GET JSON ke API AGSI dengan cookie sesi web → (httpCode, body|null) */
    private fun getJson(path: String, cookie: String): Pair<Int, JSONObject?> {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("${SiteConfig.BASE_URL}$path").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 12_000
                readTimeout = 12_000
                setRequestProperty("Accept", "application/json")
                setRequestProperty(
                    "User-Agent",
                    "AGSIAndroidApp/${BuildConfig.VERSION_NAME} (notif-poll)"
                )
                if (cookie.isNotBlank()) setRequestProperty("Cookie", cookie)
            }
            val code = conn.responseCode
            if (code in 200..299) {
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                Pair(code, JSONObject(text))
            } else {
                Pair(code, null)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Permintaan $path gagal: ${e.message}")
            Pair(0, null)
        } finally {
            conn?.disconnect()
        }
    }

    private fun parseMs(iso: String): Long =
        try {
            Instant.parse(iso).toEpochMilli()
        } catch (_: Exception) {
            0L
        }

    /** Batasi {id: createdAtMs} ke CAP entri terbaru */
    private fun pruneSeen(obj: JSONObject): String {
        if (obj.length() <= CAP) return obj.toString()
        val entries = mutableListOf<Pair<String, Long>>()
        for (key in obj.keys()) entries.add(key to obj.optLong(key, 0L))
        entries.sortByDescending { it.second }
        val out = JSONObject()
        for ((k, v) in entries.take(CAP)) out.put(k, v)
        return out.toString()
    }

    /** Batasi objek status ke CAP entri (urutan bebas — cukup batasi ukuran) */
    private fun capJson(obj: JSONObject): String {
        if (obj.length() <= CAP) return obj.toString()
        val out = JSONObject()
        var n = 0
        for (key in obj.keys()) {
            if (n++ >= CAP) break
            out.put(key, obj.optString(key))
        }
        return out.toString()
    }
}
