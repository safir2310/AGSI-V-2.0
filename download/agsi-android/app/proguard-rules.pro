# Aturan ProGuard/R8 — saat ini isMinifyEnabled=false, aturan ini tetap
# disertakan agar aman bila suatu saat minify diaktifkan.

# Jembatan JavaScript WebView (dipanggil dari halaman web via window.AgsiNative)
-keepattributes JavascriptInterface
-keepclassmembers class com.agsi.app.AgsiNativeBridge { public *; }

# Layanan push FCM (dipanggil framework Firebase lewat manifest)
-keep class com.agsi.app.PushService { *; }
