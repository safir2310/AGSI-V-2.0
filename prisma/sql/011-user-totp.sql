-- 011-user-totp.sql — Authenticator (TOTP) untuk verifikasi "lupa password".
-- Aditif & idempotent — dijalankan otomatis oleh apply-pg-schema-extras.mjs
-- pada setiap build Vercel. Aman dijalankan berulang.

-- Secret TOTP terenkripsi (AES-256-GCM) milik User; null = belum di-setup.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpSecretEnc" TEXT;
-- Waktu authenticator diaktifkan; null = belum aktif (setup pending).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpEnabledAt" TIMESTAMP(3);
-- Jalur verifikasi record reset: "email" (OTP email/push) | "totp" (authenticator).
ALTER TABLE "PasswordReset" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'email';
