/*
 * AGSI PUSH — SERVICE WORKER NOTIFIKASI (FCM / web push)
 *
 * Tugas SW:
 *   1. Menerima push dari FCM (format pesan HTTP v1) dan menampilkan
 *      NOTIFIKASI SISTEM saat aplikasi TIDAK sedang tampil di depan.
 *      Di Android Chrome, pesan dengan Urgency "high" (dikirim server)
 *      tampil sebagai HEADS-UP banner melayang.
 *   2. Saat aplikasi sedang terbuka & tampil → push diteruskan ke halaman
 *      (postMessage "AGSI_PUSH") untuk popup + suara AGSI, tanpa notifikasi
 *      sistem ganda.
 *   3. Menangani klik notifikasi → fokus/buka aplikasi di path tujuan.
 *
 * SW ini sengaja TIDAK memuat SDK Firebase — payload FCM dibaca langsung
 * dari event push (envelope JSON standar FCM), jadi tidak ada konfigurasi
 * yang perlu ditanam di berkas ini.
 */

const ICON = "/push-icon-192.png";
const BADGE = "/push-icon-192.png";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Klien (jendela aplikasi) yang sedang tampil di depan, bila ada */
async function visibleClient() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.find((c) => c.visibilityState === "visible") || null;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {};
  }

  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || d.title;
  const body = n.body || d.body;
  // Pesan tanpa isi (mis. ping internal FCM) → abaikan tanpa notifikasi
  if (!title && !body) return;

  const safeTitle = title || "AGSI — Ayam Geprek Sambal Ijo";
  const safeBody = body || "Ada pembaruan baru di aplikasi AGSI.";
  const url = d.url || "/";
  const tag = d.tag || "agsi-" + Date.now();
  const kind = d.kind || "info";

  event.waitUntil(
    (async () => {
      const client = await visibleClient();
      if (client) {
        // Aplikasi sedang di depan → popup in-app (AppShell/PushBridge yang tampil)
        client.postMessage({ type: "AGSI_PUSH", title: safeTitle, body: safeBody, url, kind });
        return;
      }
      await self.registration.showNotification(safeTitle, {
        body: safeBody,
        icon: ICON,
        badge: BADGE,
        tag,
        renotify: true, // tag sama tetap berbunyi/vibrasi ulang (butuh tag — ada)
        vibrate: [120, 60, 120],
        data: { url, kind },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin).href;
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // 1) Ada jendela yang sudah di path tujuan → fokus
      for (const c of list) {
        if (c.url === target || c.url.startsWith(target + "?")) return c.focus();
      }
      // 2) Ada jendela aplikasi lain → arahkan & fokus
      for (const c of list) {
        if ("navigate" in c) {
          try {
            await c.navigate(target);
            await c.focus();
            return;
          } catch (e) {
            break;
          }
        }
      }
      // 3) Belum ada jendela → buka baru
      return self.clients.openWindow(target);
    })()
  );
});
