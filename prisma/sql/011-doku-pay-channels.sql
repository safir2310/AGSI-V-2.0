-- 011-doku-pay-channels.sql — kolom untuk fitur "Metode Pembayaran" DOKU
-- (pemilihan kanal: E-Wallet / Minimarket / Virtual Account / Kartu Kredit).
-- Murni ADITIF & IDEMPOTENT — aman dijalankan berulang setiap deploy.
-- Order.payChannel : kunci kanal pilihan pelanggan (BCA, DANA, ALFAMART, ...)
-- Order.payMeta    : data instruksi per kanal dari DOKU (VA/kode bayar/URL)
-- StoreSetting.payChannels : JSON saklar grup kanal {va: bool, card: bool}
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "payChannel" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "payMeta" JSONB;
ALTER TABLE "StoreSetting" ADD COLUMN IF NOT EXISTS "payChannels" JSONB;
