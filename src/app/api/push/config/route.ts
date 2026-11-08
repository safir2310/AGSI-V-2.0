import { NextResponse } from "next/server";
import { isFcmConfigured } from "@/lib/fcm";

/**
 * KONFIGURASI PUBLIK UNTUK KLIEN PUSH (GET /api/push/config)
 *
 * Dipakai halaman web (dan service worker) untuk mengambil config Firebase
 * Web SDK + VAPID key TANPA menanam NEXT_PUBLIC_* saat build — jadi cukup isi
 * .env lalu restart, tanpa rebuild khusus.
 *
 * `configured` = server SIAP memakai push:
 *   - kredensial pengiriman (service account) lengkap, DAN
 *   - config web (API key/sender/app id) lengkap.
 */

export async function GET() {
  const serverReady = isFcmConfigured();
  const web = {
    apiKey: process.env.FIREBASE_WEB_API_KEY?.trim() || null,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN?.trim() || null,
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || null,
    messagingSenderId: process.env.FIREBASE_SENDER_ID?.trim() || null,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim() || null,
    appId: process.env.FIREBASE_APP_ID?.trim() || null,
  };
  const webReady = !!(web.apiKey && web.projectId && web.messagingSenderId && web.appId);

  return NextResponse.json({
    configured: serverReady && webReady,
    serverReady,
    webReady,
    web: webReady ? web : null,
    vapidKey: process.env.FIREBASE_VAPID_KEY?.trim() || null,
  });
}
