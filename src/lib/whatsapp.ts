/**
 * KLIEN WHATSAPP CLOUD API (META) — HTTP API langsung, TANPA dependensi
 * tambahan (pola yang sama dengan lib/email.ts).
 *
 * Dipakai alur "Lupa Password" untuk MENAMBAH jalur pengiriman kode OTP 6
 * digit lewat WhatsApp (selain email Resend) — permintaan pemilik.
 * Konfigurasi lewat env Vercel/.env:
 *   WHATSAPP_ACCESS_TOKEN      = token permanen dari developers.facebook.com
 *   WHATSAPP_PHONE_NUMBER_ID   = ID nomor WhatsApp Business
 *   WHATSAPP_BUSINESS_ACCOUNT_ID = WABA ID (untuk audit/konfigurasi webhook)
 *   WHATSAPP_VERIFY_TOKEN      = token verifikasi webhook (dipakai nanti saat
 *                                webhook pesan masuk diaktifkan)
 *   WHATSAPP_OTP_TEMPLATE      = (opsional) nama template OTP yang sudah
 *                                disetujui Meta — dipakai OTOMATIS sebagai
 *                                fallback ketika pesan bebas ditolak karena
 *                                penerima belum pernah chat (sesi 24 jam)
 *   WHATSAPP_OTP_TEMPLATE_LANG = (opsional) kode bahasa template, bawaan "id"
 *
 * Catatan penting Cloud API: pesan BEBAS (type text) hanya boleh dikirim ke
 * pengguna yang pernah berkirim pesan ke nomor bisnis dalam 24 jam terakhir.
 * Di luar itu Meta menolak (error 131047 / 131026) — karena itu:
 *   1. coba pesan bebas dulu (gratis, tanpa perlu template);
 *   2. bila ditolak dan WHATSAPP_OTP_TEMPLATE diisi → ulang pakai template.
 *
 * Aman dipanggil walau belum dikonfigurasi — semua fungsi mengembalikan
 * hasil, tidak pernah melempar. Token TIDAK pernah dicetak ke log/error.
 */

const GRAPH_VERSION = "v21.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type SendWhatsAppResult = {
  ok: boolean;
  /** pesan error siap-tampil (Indonesia + detail Meta bila ada) */
  error?: string;
  /** true = ditolak karena penerima di luar sesi 24 jam (perlu template) */
  needsTemplate?: boolean;
};

/** true bila jalur WhatsApp sisi server sudah siap (token + phone number id) */
export function isWhatsAppConfigured(): boolean {
  return !!(
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  );
}

/** Normalisasi no. HP Indonesia → format internasional 62… tanpa tanda:
 *  0812-3456-7890 → 6281234567890 • +62 812… → 62812… • 812… → 62812…
 *  null bila tidak bisa dinormalisasi (terlalu pendek / bukan pola Indonesia) */
export function normalizeWhatsappPhone(raw: string): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  let intl = d;
  if (d.startsWith("62")) {
    // sudah internasional
  } else if (d.startsWith("0")) {
    intl = `62${d.slice(1)}`;
  } else if (d.startsWith("8")) {
    intl = `62${d}`;
  }
  return /^62\d{8,13}$/.test(intl) ? intl : null;
}

/** Tutup sebagian nomor untuk ditampilkan di UI: 62812xxxx345 → 62812••••345 */
export function maskWhatsappPhone(raw: string): string {
  const intl = normalizeWhatsappPhone(raw) ?? String(raw ?? "").replace(/\D/g, "");
  if (intl.length <= 8) return intl;
  return `${intl.slice(0, 5)}••••${intl.slice(-3)}`;
}

/** Kirim payload ke endpoint messages Cloud API. Tidak pernah melempar. */
async function graphSendMessage(
  payload: Record<string, unknown>
): Promise<SendWhatsAppResult & { status: number }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneId) {
    return { ok: false, status: 0, error: "WhatsApp belum dikonfigurasi di server (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID kosong)." };
  }
  try {
    const res = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: unknown[];
      error?: { code?: number; message?: string; error_data?: { details?: string } };
    };
    if (res.ok && body.messages) return { ok: true, status: res.status };

    const code = body.error?.code ?? 0;
    const details = body.error?.error_data?.details ?? body.error?.message ?? `HTTP ${res.status}`;
    // Di luar sesi 24 jam → Meta menolak pesan bebas; tandai agar pemanggil
    // bisa mencoba lagi dengan template yang sudah disetujui.
    const needsTemplate = code === 131047 || code === 131026;
    return {
      ok: false,
      status: res.status,
      needsTemplate,
      error: needsTemplate
        ? `Penerima belum pernah chat nomor WhatsApp AGSI dalam 24 jam terakhir, jadi pesan bebas ditolak Meta (${details}).`
        : `WhatsApp gagal terkirim: ${details}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? `Tidak dapat menghubungi WhatsApp Cloud API: ${err.message}` : "Tidak dapat menghubungi WhatsApp Cloud API.",
    };
  }
}

/** Pesan bebas (type text) — hanya sah dalam sesi 24 jam */
async function sendWhatsAppFreeText(to: string, text: string): Promise<SendWhatsAppResult> {
  const r = await graphSendMessage({ to, type: "text", text: { preview_url: false, body: text } });
  return { ok: r.ok, error: r.error, needsTemplate: r.needsTemplate };
}

/** Template OTP (type template) — satu parameter body: kode OTP */
async function sendWhatsAppTemplate(to: string, name: string, code: string): Promise<SendWhatsAppResult> {
  const lang = process.env.WHATSAPP_OTP_TEMPLATE_LANG?.trim() || "id";
  const r = await graphSendMessage({
    to,
    type: "template",
    template: {
      name,
      language: { code: lang },
      components: [{ type: "body", parameters: [{ type: "text", text: code }] }],
    },
  });
  return { ok: r.ok, error: r.error, needsTemplate: r.needsTemplate };
}

/** Kirim OTP reset password via WhatsApp. Tidak pernah melempar — selalu hasil. */
export async function sendWhatsAppOtp(phone: string, code: string, minutes: number): Promise<SendWhatsAppResult> {
  const to = normalizeWhatsappPhone(phone);
  if (!to) {
    return { ok: false, error: "No. HP pada akun tidak valid untuk WhatsApp (harus pola 08…/62…)." };
  }
  const text =
    `🔐 *Kode Reset Password AGSI*\n\n` +
    `Kode kamu: *${code}*\n\n` +
    `⏳ Berlaku ${minutes} menit dan hanya bisa dipakai sekali.\n\n` +
    `Jangan bagikan kode ini ke siapa pun — petugas AGSI tidak pernah meminta kode.\n` +
    `Bukan kamu yang meminta? Abaikan pesan ini, passwordmu tetap aman.`;
  const first = await sendWhatsAppFreeText(to, text);
  if (first.ok) return { ok: true };

  // Pesan bebas ditolak (di luar sesi 24 jam) → coba template bila ada
  const tpl = process.env.WHATSAPP_OTP_TEMPLATE?.trim();
  if (first.needsTemplate && tpl) {
    const second = await sendWhatsAppTemplate(to, tpl, code);
    if (second.ok) return { ok: true };
    return {
      ok: false,
      error: `${second.error} (pesan bebas juga ditolak: ${first.error})`,
      needsTemplate: second.needsTemplate,
    };
  }
  return first;
}
