import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
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
 * - FALLBACK STAFF: bila email gagal terkirim di production (mis. Resend
 *   masih mode testing — pengirim resend.dev hanya boleh ke email pemilik
 *   akun Resend), akun ADMIN/OWNER menerima kode lewat notifikasi push ke
 *   perangkat terdaftar miliknya sendiri.
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

    if (!isEmailConfigured()) {
      return NextResponse.json(
        { error: "Layanan email belum aktif di server. Minta admin mengisi RESEND_API_KEY di .env (panduan: EMAIL_SETUP.md)." },
        { status: 503 }
      );
    }

    // OTP 6 digit acak (crypto-secure), disimpan sebagai hash — bukan teks polos
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");

    const send = await sendEmail({
      to: normalized,
      // sebut akun tujuan — penting saat OTP diteruskan ke inbox pemilik (fallback)
      subject: `Kode Reset Password AGSI (untuk ${normalized})`,
      html: otpEmailHtml(otp, RESET_MINUTES),
    });

    if (!send.ok) {
      if (process.env.NODE_ENV === "production") {
        // Fallback STAFF: ADMIN/OWNER menerima OTP via push ke perangkatnya
        // (email Resend masih mode testing — tidak bisa kirim ke email lain).
        if (user.role === "ADMIN" || user.role === "OWNER") {
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
          // Fallback kedua (pola recovery address): kirim OTP ke email pemilik
          // akun Resend — satu-satunya penerima yang diizinkan saat mode
          // testing. Hanya utk akun staff; OTP pelanggan tidak diteruskan.
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
        return NextResponse.json({ error: send.error ?? "Email gagal terkirim." }, { status: 502 });
      }
      // Development: lanjutkan alur meski email gagal — OTP dicatat ke .otp-dev.log
    }
    devLogOtp(normalized, otp);

    // Hapus sesi verifikasi lama: yang sudah kedaluwarsa (kebersihan tabel)
    // dan yang belum terpakai milik email ini (satu OTP aktif per email).
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
