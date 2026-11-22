import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { isEmailConfigured, otpEmailHtml, devLogOtp, sendEmail } from "@/lib/email";
import { isWhatsAppConfigured, maskWhatsappPhone, sendWhatsAppOtp } from "@/lib/whatsapp";
import { notifyOtpEmailFailed } from "@/lib/push";

/**
 * POST /api/auth/forgot-password
 * Langkah 1 alur lupa password: user memasukkan email terdaftar lalu MEMILIH
 * salah satu dari 2 OPSI kanal pengiriman OTP (permintaan pemilik):
 *   - channel "email"    (bawaan): OTP dikirim lewat EMAIL (Resend) DAN —
 *                                seperti versi sebelumnya — sekaligus lewat
 *                                WHATSAPP bila no. HP akun terdaftar & jalur
 *                                siap (WhatsApp = cadangan otomatis)
 *   - channel "whatsapp"       : OTP dikirim HANYA lewat WHATSAPP (Cloud API
 *                                Meta) ke no. HP yang terdaftar pada akun
 *
 * - OTP berlaku 10 menit, sekali pakai, maks 5 kali salah memasukkan
 *   (dikecek di langkah 2 — reset-password).
 * - Cooldown 60 detik antar permintaan kode (anti spam / brute force).
 * - Record PasswordReset dibuat SEBELUM pengiriman: semua jalur sukses
 *   (email / WhatsApp / fallback staff) wajib punya record agar langkah 2
 *   bisa memverifikasi.
 * - FALLBACK STAFF (production, kanal terpilih gagal): akun ADMIN/OWNER
 *   menerima kode lewat notifikasi push ke perangkat terdaftar miliknya
 *   sendiri, lalu (recovery address) ke inbox pemilik akun Resend.
 * - Development: OTP tetap tersimpan & dicatat ke `.otp-dev.log` supaya alur
 *   bisa diuji lokal. Kanal terpilih pada mode development tetap dikirim
 *   nyata bila dikonfigurasi (berguna untuk menguji jalurnya).
 */
const RESET_MINUTES = 10;
const RESEND_COOLDOWN_MS = 60_000;

export async function POST(req: NextRequest) {
  try {
    const { email, channel } = await req.json();
    const normalized = String(email ?? "").toLowerCase().trim();
    if (!normalized || !normalized.includes("@")) {
      return NextResponse.json(
        { error: "Masukkan email yang valid dulu ya." },
        { status: 400 }
      );
    }
    const otpChannel =
      String(channel ?? "email").toLowerCase() === "whatsapp" ? "whatsapp" : "email";

    const user = await db.user.findUnique({ where: { email: normalized } });
    if (!user) {
      return NextResponse.json(
        { error: "Email ini belum terdaftar. Coba periksa lagi atau daftar akun baru." },
        { status: 404 }
      );
    }

    // Cooldown: kode terakhir (apa pun statusnya) baru saja diminta?
    const latest = await db.passwordReset.findFirst({
      where: { email: normalized },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      const elapsed = Date.now() - latest.createdAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json(
          { error: `Kode OTP baru saja dikirim. Tunggu ${wait} detik lagi, atau cek email / WhatsApp ya.`, retryAfter: wait },
          { status: 429 }
        );
      }
    }

    // Validasi kesiapan kanal TERPILIH (kanal terpisah — tidak ada auto-pindah)
    // "" = bukan kanal WhatsApp; guard !waPhone di bawah tetap menolak kosong
    const waPhone: string = otpChannel === "whatsapp" ? (user.phone ?? "") : "";
    if (otpChannel === "whatsapp") {
      if (!isWhatsAppConfigured()) {
        return NextResponse.json(
          { error: "Jalur WhatsApp belum aktif di server. Gunakan opsi Email, atau minta admin mengisi env WHATSAPP_* (panduan: EMAIL_SETUP.md)." },
          { status: 503 }
        );
      }
      if (!waPhone) {
        return NextResponse.json(
          { error: "Akun ini tidak punya nomor HP terdaftar, jadi OTP WhatsApp tidak bisa dikirim. Gunakan opsi Email." },
          { status: 400 }
        );
      }
    } else if (!isEmailConfigured() && !isWhatsAppConfigured()) {
      return NextResponse.json(
        { error: "Layanan email & WhatsApp belum aktif di server. Minta admin mengisi RESEND_API_KEY dan WHATSAPP_ACCESS_TOKEN di .env (panduan: EMAIL_SETUP.md)." },
        { status: 503 }
      );
    }

    // OTP 6 digit acak (crypto-secure), disimpan sebagai hash — bukan teks polos
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");

    // Hapus sesi verifikasi lama: yang sudah kedaluwarsa (kebersihan tabel)
    // dan yang belum terpakai milik email ini (satu OTP aktif per email).
    // Record BARU dibuat SEBELUM pengiriman — semua jalur sukses (email /
    // WhatsApp / push staff / inbox pemilik) memakai record yang sama.
    await db.passwordReset.deleteMany({
      where: { email: normalized, expiresAt: { lt: new Date() } },
    });
    await db.passwordReset.deleteMany({
      where: { email: normalized, usedAt: null },
    });
    await db.passwordReset.create({
      data: {
        email: normalized,
        codeHash: hashPassword(otp),
        expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
      },
    });
    devLogOtp(normalized, otp);

    // ===== KIRIM OTP — opsi WhatsApp: HANYA lewat WhatsApp =====
    if (otpChannel === "whatsapp") {
      const wa = await sendWhatsAppOtp(waPhone, otp, RESET_MINUTES);
      if (!wa.ok && process.env.NODE_ENV === "production") {
        // Fallback STAFF: push ke perangkat terdaftar → inbox pemilik
        if (user.role === "ADMIN" || user.role === "OWNER") {
          const delivered = await notifyOtpEmailFailed(user.id, otp, RESET_MINUTES);
          if (delivered > 0) {
            return NextResponse.json({
              ok: true,
              minutes: RESET_MINUTES,
              channel: "whatsapp",
              viaPush: true,
              note: `WhatsApp gagal (${wa.error}) — kode OTP dikirim lewat notifikasi aplikasi AGSI di perangkatmu (${delivered} perangkat).`,
            });
          }
          const ownerInbox = process.env.RESEND_FALLBACK_TO?.trim();
          if (ownerInbox) {
            const send2 = await sendEmail({
              to: ownerInbox,
              subject: `Kode Reset Password AGSI (untuk ${normalized})`,
              html: otpEmailHtml(otp, RESET_MINUTES),
            });
            if (send2.ok) {
              return NextResponse.json({
                ok: true,
                minutes: RESET_MINUTES,
                channel: "whatsapp",
                viaOwnerEmail: true,
                fallbackTo: ownerInbox,
                note: `WhatsApp gagal (${wa.error}) — kode OTP dikirim ke email pemilik akun Resend (${ownerInbox}). Cek inbox & folder spam di sana.`,
              });
            }
            return NextResponse.json(
              {
                error:
                  `${wa.error} Fallback notifikasi aplikasi tak bisa (belum ada perangkat terdaftar) dan pengiriman ke inbox pemilik (${ownerInbox}) juga gagal. Coba opsi Email.`,
              },
              { status: 502 }
            );
          }
          return NextResponse.json(
            {
              error:
                `${wa.error} Fallback notifikasi aplikasi tak bisa (belum ada perangkat terdaftar). Isi env RESEND_FALLBACK_TO (email pemilik akun Resend) atau coba opsi Email.`,
            },
            { status: 502 }
          );
        }
        // Pelanggan: laporkan penyebab asli + sarankan opsi lain
        return NextResponse.json(
          { error: `${wa.error} Coba opsi Email di halaman lupa password.` },
          { status: 502 }
        );
      }
      // Development: lanjutkan alur meski WA gagal — OTP ada di .otp-dev.log
      return NextResponse.json({
        ok: true,
        minutes: RESET_MINUTES,
        channel: "whatsapp",
        whatsappSent: wa.ok,
        whatsappTo: wa.ok ? maskWhatsappPhone(waPhone) : undefined,
        whatsappError: !wa.ok ? wa.error : undefined,
        devNote: !wa.ok ? "OTP dicatat di berkas .otp-dev.log (mode development)" : undefined,
      });
    }

    // ===== Kanal EMAIL — seperti versi sebelumnya: EMAIL + WHATSAPP sekaligus =====
    // (WhatsApp otomatis jadi cadangan bila email gagal — perilaku lama)
    const send = isEmailConfigured()
      ? await sendEmail({
          to: normalized,
          // sebut akun tujuan — penting saat OTP diteruskan ke inbox pemilik (fallback)
          subject: `Kode Reset Password AGSI (untuk ${normalized})`,
          html: otpEmailHtml(otp, RESET_MINUTES),
        })
      : { ok: false as const, error: "Layanan email belum dikonfigurasi di server (isi RESEND_API_KEY di .env — lihat EMAIL_SETUP.md)." };

    // WhatsApp hanya bila jalurnya siap & akun punya no. HP terdaftar
    const wa =
      isWhatsAppConfigured() && user.phone
        ? await sendWhatsAppOtp(user.phone, otp, RESET_MINUTES)
        : null;

    if (!send.ok && process.env.NODE_ENV === "production") {
      // Fallback 1 — WhatsApp: email gagal tapi kode sampai via WhatsApp ✓
      if (wa?.ok) {
        return NextResponse.json({
          ok: true,
          minutes: RESET_MINUTES,
          channel: "email",
          emailed: false,
          viaWhatsapp: true,
          whatsappTo: maskWhatsappPhone(user.phone!),
          note: `Email gagal terkirim (${send.error ?? "tidak diketahui"}) — kode OTP dikirim ke WhatsApp ${maskWhatsappPhone(user.phone!)}.`,
        });
      }
      // Fallback 2 — STAFF: push ke perangkat terdaftar → inbox pemilik
      if (user.role === "ADMIN" || user.role === "OWNER") {
        const delivered = await notifyOtpEmailFailed(user.id, otp, RESET_MINUTES);
        if (delivered > 0) {
          return NextResponse.json({
            ok: true,
            minutes: RESET_MINUTES,
            channel: "email",
            emailed: false,
            viaPush: true,
            note: `Email gagal terkirim (layanan email masih mode testing)${
              wa ? ` dan WhatsApp juga gagal (${wa.error})` : ""
            } — kode OTP dikirim lewat notifikasi aplikasi AGSI di perangkatmu (${delivered} perangkat).`,
          });
        }
        const ownerInbox = process.env.RESEND_FALLBACK_TO?.trim();
        if (ownerInbox) {
          const send2 = await sendEmail({
            to: ownerInbox,
            subject: `Kode Reset Password AGSI (untuk ${normalized})`,
            html: otpEmailHtml(otp, RESET_MINUTES),
          });
          if (send2.ok) {
            return NextResponse.json({
              ok: true,
              minutes: RESET_MINUTES,
              channel: "email",
              emailed: false,
              viaOwnerEmail: true,
              fallbackTo: ownerInbox,
              note: `Layanan email masih mode testing — kode OTP dikirim ke email pemilik akun Resend (${ownerInbox}). Cek inbox & folder spam di sana.`,
            });
          }
          return NextResponse.json(
            {
              // send.error & send2.error sudah berprefiks "Email gagal terkirim: …"
              error:
                `${send.error ?? "Email gagal terkirim."} ` +
                `${wa ? `WhatsApp juga gagal: ${wa.error} ` : ""}` +
                `Fallback notifikasi aplikasi tak bisa (belum ada perangkat terdaftar) dan pengiriman ke inbox pemilik (${ownerInbox}) juga gagal. ` +
                `Verifikasi domain di resend.com/domains untuk solusi permanen.`,
            },
            { status: 502 }
          );
        }
        // RESEND_FALLBACK_TO belum diisi → pandu konfigurasi
        return NextResponse.json(
          {
            error:
              `${send.error ?? "Email gagal terkirim."} ` +
              `${wa ? `WhatsApp juga gagal: ${wa.error} ` : ""}` +
              `Fallback notifikasi aplikasi tak bisa (belum ada perangkat terdaftar). ` +
              `Isi env RESEND_FALLBACK_TO (email pemilik akun Resend) atau verifikasi domain di resend.com/domains.`,
          },
          { status: 502 }
        );
      }
      return NextResponse.json(
        {
          error:
            `${send.error ?? "Email gagal terkirim."} ` +
            (wa ? ` WhatsApp juga gagal: ${wa.error}` : " Akun tidak punya no. HP untuk jalur WhatsApp — tambahkan no. HP di profil akun."),
        },
        { status: 502 }
      );
    }
    // Development: lanjutkan alur meski email gagal — OTP dicatat ke .otp-dev.log

    return NextResponse.json({
      ok: true,
      minutes: RESET_MINUTES,
      channel: "email",
      /** false = email gagal terkirim (dev saja) — OTP ada di .otp-dev.log */
      emailed: send.ok,
      /** jalur WhatsApp (cadangan otomatis — perilaku versi sebelumnya) */
      whatsappSent: !!wa?.ok,
      whatsappTo: wa?.ok ? maskWhatsappPhone(user.phone!) : undefined,
      whatsappError: wa && !wa.ok ? wa.error : undefined,
      devNote: !send.ok ? "OTP dicatat di berkas .otp-dev.log (mode development)" : undefined,
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
