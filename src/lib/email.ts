import { appendFileSync } from "fs";
import { resolve } from "path";

/**
 * KLIEN EMAIL (RESEND) — HTTP API langsung, TANPA dependensi tambahan.
 *
 * Dipakai alur "Lupa Password" untuk mengirim kode OTP 6 digit ke email
 * terdaftar. Konfigurasi lewat .env:
 *   RESEND_API_KEY = re_...   (API key dari resend.com/api-keys)
 *   RESEND_FROM    = "AGSI POS <no-reply@domainmu>"   (opsional)
 *
 * ⚠️ Tanpa domain terverifikasi di Resend, pengirim fallback
 *    `onboarding@resend.dev` HANYA bisa mengirim ke email pemilik akun
 *    Resend. Error dari Resend diteruskan apa adanya ke UI supaya jelas.
 *
 * Mode development (NODE_ENV !== "production"): setiap OTP juga dicatat ke
 * berkas `.otp-dev.log` di root proyek — memudahkan pengujian lokal tanpa
 * membuka inbox. Berkas ini TIDAK PERNAH ditulis di production.
 *
 * Aman dipanggil walau belum dikonfigurasi — semua fungsi mengembalikan
 * hasil, tidak pernah melempar.
 */

const RESEND_URL = "https://api.resend.com/emails";
const DEV_OTP_LOG = resolve(process.cwd(), ".otp-dev.log");

/** true bila layanan email sisi server sudah siap (RESEND_API_KEY terisi) */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

function fromAddress(): string {
  return process.env.RESEND_FROM?.trim() || "AGSI POS <onboarding@resend.dev>";
}

export type SendEmailResult = {
  ok: boolean;
  /** pesan error siap-tampil (Indonesia + detail Resend bila ada) */
  error?: string;
};

/** Kirim email HTML via Resend. Tidak pernah melempar — selalu hasil. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "Layanan email belum dikonfigurasi di server (isi RESEND_API_KEY di .env — lihat EMAIL_SETUP.md)." };
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (res.ok) return { ok: true };

    const body = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
    const detail = body.message ?? `HTTP ${res.status}`;
    return { ok: false, error: `Email gagal terkirim: ${detail}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `Tidak dapat menghubungi layanan email: ${err.message}` : "Tidak dapat menghubungi layanan email.",
    };
  }
}

/** Template email OTP bergaya AGSI (orange, jelas, anti-phishing note) */
export function otpEmailHtml(code: string, minutes: number, appName = "AGSI POS"): string {
  return `<!DOCTYPE html>
<html lang="id">
<body style="margin:0;padding:0;background:#fff7ed;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#9a3412,#ea580c);border-radius:20px 20px 0 0;padding:28px 24px;text-align:center;">
      <p style="margin:0;font-size:22px;font-weight:900;color:#ffffff;letter-spacing:1px;">🍗 ${appName}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#ffedd5;">Kode Reset Password</p>
    </div>
    <div style="background:#ffffff;border-radius:0 0 20px 20px;padding:28px 24px;border:1px solid #ffedd5;border-top:none;">
      <p style="margin:0 0 8px;font-size:14px;color:#525252;">Halo 👋</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#525252;">
        Kami menerima permintaan reset password untuk akunmu. Masukkan kode berikut di aplikasi:
      </p>
      <div style="background:#fff7ed;border:2px dashed #fdba74;border-radius:16px;padding:18px;text-align:center;">
        <p style="margin:0;font-size:36px;font-weight:900;letter-spacing:10px;color:#9a3412;">${code}</p>
      </div>
      <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#525252;">
        ⏳ Kode berlaku <b>${minutes} menit</b> dan hanya bisa dipakai sekali.
      </p>
      <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#a3a3a3;">
        Bukan kamu yang meminta? Abaikan email ini — passwordmu tetap aman.
        Jangan pernah membagikan kode ini ke siapa pun, termasuk petugas ${appName}.
      </p>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#a3a3a3;">Email otomatis — mohon jangan dibalas.</p>
  </div>
</body>
</html>`;
}

/** Catat OTP ke .otp-dev.log (HANYA development) supaya E2E bisa membacanya */
export function devLogOtp(email: string, code: string): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    appendFileSync(DEV_OTP_LOG, `${new Date().toISOString()}\t${email}\t${code}\n`);
  } catch {
    // logging dev gagal — abaikan
  }
}
