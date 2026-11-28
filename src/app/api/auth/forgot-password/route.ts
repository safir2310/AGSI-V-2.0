import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomInt } from "crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { isEmailConfigured, otpEmailHtml, devLogOtp, sendEmail } from "@/lib/email";
import { notifyOtpEmailFailed } from "@/lib/push";

/**
 * POST /api/auth/forgot-password
 * Langkah 1 alur lupa password: user memasukkan email terdaftar, server
 * membuat OTP 6 digit acak lalu mengirimkannya lewat EMAIL (Resend).
 *
 * - OTP berlaku 10 menit, sekali pakai, maks 5 kali salah memasukkan
 *   (dikecek di langkah 2 — reset-password).
 * - Cooldown 60 detik antar permintaan kode (anti spam / brute force).
 * - AUTHENTICATOR (TOTP): akun yang mengaktifkan authenticator (totpEnabledAt)
 *   tidak menerima OTP email — respons { mode: "totp" } dan langkah 2
 *   memverifikasi kode dari aplikasi authenticator (lihat reset-password).
 * - FALLBACK (production, email gagal terkirim — mis. Resend masih mode
 *   testing: pengirim resend.dev hanya boleh ke email pemilik akun Resend):
 *   1) SEMUA peran → kode dikirim lewat notifikasi push ke perangkat
 *      terdaftar milik akun itu sendiri (faktor kepemilikan perangkat);
 *   2) ADMIN/OWNER → bila tak ada perangkat, kode diteruskan ke inbox
 *      pemilik akun Resend (RESEND_FALLBACK_TO); OTP pelanggan tak pernah
 *      diteruskan ke sana (privasi).
 * - Record PasswordReset dibuat SEBELUM pengiriman — semua jalur sukses
 *   (email / push / inbox pemilik) memakai record yang sama, sehingga kode
 *   yang diterima via notifikasi selalu bisa diverifikasi di langkah 2
 *   (memperbaiki bug lama versi 1.3.30).
 * - Development: bila Resend menolak (mis. penerima bukan email terverifikasi)
 *   OTP tetap tersimpan & dicatat ke `.otp-dev.log` supaya alur bisa diuji
 *   lokal. Production selalu gagal-keras agar masalah konfigurasi terlihat.
 */
const RESET_MINUTES = 10;
const RESEND_COOLDOWN_MS = 60_000;

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    const normalized = String(email ?? "").toLowerCase().trim();
    if (!normalized || !normalized.includes("@")) {
      return NextResponse.json(
        { error: "Masukkan email yang valid dulu ya." },
        { status: 400 }
      );
    }

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
          { error: `Kode OTP baru saja dikirim. Tunggu ${wait} detik lagi, atau cek folder spam.`, retryAfter: wait },
          { status: 429 }
        );
      }
    }

    // ===== AUTHENTICATOR (TOTP) =====
    // Akun dengan authenticator aktif TIDAK memakai OTP email sama sekali:
    // kode verifikasi diambil dari aplikasi authenticator milik user
    // (Google Authenticator / Authy / Aegis dll). Record PasswordReset tetap
    // dibuat (mode "totp") supaya langkah 2 punya batas percobaan & kedaluwarsa
    // yang sama — tanpa mengirim email/push apa pun (tidak butuh layanan email).
    if (user.totpEnabledAt) {
      await db.passwordReset.deleteMany({
        where: { email: normalized, usedAt: null },
      });
      await db.passwordReset.create({
        data: {
          email: normalized,
          // codeHash tidak dipakai di jalur TOTP — diisi acak agar tak pernah cocok
          codeHash: hashPassword(randomBytes(16).toString("hex")),
          expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
          mode: "totp",
        },
      });
      return NextResponse.json({
        ok: true,
        mode: "totp",
        minutes: RESET_MINUTES,
        note: "Akun ini memakai Authenticator — masukkan kode 6 digit dari aplikasi authenticator (bukan email).",
      });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json(
        { error: "Layanan email belum aktif di server. Minta admin mengisi RESEND_API_KEY di .env (panduan: EMAIL_SETUP.md)." },
        { status: 503 }
      );
    }

    // OTP 6 digit acak (crypto-secure), disimpan sebagai hash — bukan teks polos
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    devLogOtp(normalized, otp);

    // Record dibuat SEBELUM pengiriman: semua jalur sukses (email / push /
    // inbox pemilik) wajib punya record agar langkah 2 bisa memverifikasi —
    // memperbaiki bug lama versi 1.3.30 (jalur fallback tidak menyimpan
    // record sehingga kode via notifikasi selalu ditolak di langkah 2).
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

    const send = await sendEmail({
      to: normalized,
      // sebut akun tujuan — penting saat OTP diteruskan ke inbox pemilik (fallback)
      subject: `Kode Reset Password AGSI (untuk ${normalized})`,
      html: otpEmailHtml(otp, RESET_MINUTES),
    });

    if (!send.ok) {
      if (process.env.NODE_ENV === "production") {
        // Fallback 1 — SEMUA peran: push ke perangkat terdaftar milik akun
        // itu sendiri (email Resend masih mode testing — pengirim resend.dev
        // hanya boleh ke email pemilik akun Resend).
        const delivered = await notifyOtpEmailFailed(user.id, otp, RESET_MINUTES);
        if (delivered > 0) {
          return NextResponse.json({
            ok: true,
            minutes: RESET_MINUTES,
            emailed: false,
            viaPush: true,
            note: `Email gagal terkirim (layanan email masih mode testing) — kode OTP dikirim lewat notifikasi aplikasi AGSI di perangkatmu (${delivered} perangkat).`,
          });
        }
        // Fallback 2 — STAFF (ADMIN/OWNER): pola recovery address — kirim OTP
        // ke inbox pemilik akun Resend, satu-satunya penerima yang diizinkan
        // saat mode testing. OTP pelanggan TIDAK pernah diteruskan ke sana
        // (privasi).
        if (user.role === "ADMIN" || user.role === "OWNER") {
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
                `Fallback notifikasi aplikasi tak bisa (belum ada perangkat terdaftar). ` +
                `Isi env RESEND_FALLBACK_TO (email pemilik akun Resend) atau verifikasi domain di resend.com/domains.`,
            },
            { status: 502 }
          );
        }
        // Pelanggan tanpa perangkat terdaftar: jelaskan penyebab + jalan keluar
        return NextResponse.json(
          {
            error:
              `${send.error ?? "Email gagal terkirim."} ` +
              `Belum ada perangkat aplikasi AGSI yang terdaftar untuk akun ini, jadi kode tidak bisa dikirim lewat notifikasi. ` +
              `Login sekali di aplikasi dengan akun ini lalu ulangi lupa password, atau tunggu admin memverifikasi domain di resend.com/domains agar OTP email terkirim normal.`,
          },
          { status: 502 }
        );
      }
      // Development: lanjutkan alur meski email gagal — OTP dicatat ke .otp-dev.log
    }

    return NextResponse.json({
      ok: true,
      minutes: RESET_MINUTES,
      /** false = email gagal terkirim (dev saja) — OTP ada di .otp-dev.log */
      emailed: send.ok,
      devNote: !send.ok ? "OTP dicatat di berkas .otp-dev.log (mode development)" : undefined,
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
