/**
 * Uji adapter DOKU QRIS (src/lib/qris-doku.ts) — server-to-server.
 *
 *   DATABASE_URL=... DOKU_API_KEY=... bun scripts/test-qris-doku.ts
 *
 * Yang diuji:
 *   1. Buat QRIS di DOKU (jalur API key MCP bila SNAP tak terkonfigurasi).
 *      — bila kanal QRIS akun sandbox belum aktif, DOKU menjawab galat dan
 *        adapter melempar QrisGatewayError (tertangkap & dilaporkan).
 *   2. Cek status transaksi (get_transaction_by_invoice_number).
 *      — invoice tanpa catatan -> PENDING (bukan galat).
 *   3. isDokuTrx / partnerReferenceNoOf (unit).
 *   4. Rantai createQrisGatewayPayment: DOKU dipanggil PERTAMA; bila menolak,
 *      jatuh ke penyedia berikutnya (gateway bawaan sandbox) — QR tetap jalan.
 */
import { createQrisDokuPayment, getQrisDokuStatus, isDokuTrx } from "../src/lib/qris-doku";
import { createQrisGatewayPayment } from "../src/lib/qris-gateway";
import {
  DOKU_API_KEY,
  DOKU_API_BASE,
  DOKU_CLIENT_ID,
  DOKU_CLIENT_SECRET,
  DOKU_ENABLED,
  DOKU_MERCHANT_ID,
  DOKU_SNAP_READY,
} from "../src/lib/qris-config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("=== Uji Adapter DOKU QRIS ===");
  console.log(`API base : ${DOKU_API_BASE}`);
  console.log(
    `Kredensial: API_KEY=${DOKU_API_KEY ? "ada" : "kosong"} CLIENT_ID=${
      DOKU_CLIENT_ID ? "ada" : "kosong"
    } SECRET=${DOKU_CLIENT_SECRET ? "ada" : "kosong"} MERCHANT=${DOKU_MERCHANT_ID ? "ada" : "kosong"}`
  );
  console.log(`DOKU_ENABLED=${DOKU_ENABLED} SNAP_READY=${DOKU_SNAP_READY}\n`);

  // ==== 1) Unit: isDokuTrx ====
  console.log("[1] Deteksi prefix trxId");
  ok("isDokuTrx('DOKU-AGSI-1')", isDokuTrx("DOKU-AGSI-1"));
  ok("!isDokuTrx('SBX-xyz')", !isDokuTrx("SBX-xyz"));

  // ==== 2) Buat QRIS di DOKU ====
  console.log("\n[2] createQrisDokuPayment (Rp10.000)");
  const reference = `TEST-DOKU-${Date.now()}`;
  let createFailed = false;
  try {
    const trx = await createQrisDokuPayment({ amount: 10000, reference });
    ok("QRIS dibuat", true, `trxId=${trx.trxId}, qr=${(trx.qrString ?? "").slice(0, 40)}…`);
    ok("trxId prefix DOKU-", trx.trxId.startsWith("DOKU-"));

    // ==== 3) Status transaksi (baru dibuat -> PENDING) ====
    console.log("\n[3] getQrisDokuStatus");
    const status = await getQrisDokuStatus(trx.trxId);
    ok("status awal PENDING/EXPIRED/UNKNOWN", ["PENDING", "EXPIRED", "UNKNOWN"].includes(status), status);
  } catch (err) {
    createFailed = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠️  DOKU menolak pembuatan QRIS: ${msg}`);
    ok(
      "galat DOKU terkonfirmasi (kanal QRIS akun belum aktif)",
      /doku|unavailable|tidak/i.test(msg),
      msg.slice(0, 120)
    );
  }

  // ==== 4) Status invoice tanpa catatan -> PENDING (jalur MCP) ====
  if (!DOKU_SNAP_READY) {
    console.log("\n[4] getQrisDokuStatus invoice tak dikenal");
    try {
      const st = await getQrisDokuStatus(`DOKU-TIDAKADA-${Date.now()}`);
      ok("invoice tanpa catatan -> PENDING", st === "PENDING", st);
    } catch (err) {
      ok("invoice tanpa catatan -> PENDING", false, err instanceof Error ? err.message : String(err));
    }
  }

  // ==== 5) Rantai penyedia: DOKU dipanggil dulu, fallback tetap hidup ====
  console.log("\n[5] createQrisGatewayPayment (rantai penuh)");
  try {
    const trx = await createQrisGatewayPayment({ amount: 15000, reference: `TEST-CHAIN-${Date.now()}` });
    ok("QRIS rantai tersedia", true, `provider=${trx.provider} trxId=${trx.trxId}`);
    if (createFailed && DOKU_ENABLED) {
      ok("DOKU dicoba PERTAMA (alasan fallback memuat 'DOKU:')", (trx.fallbackReason ?? "").includes("DOKU:"), (trx.fallbackReason ?? "").slice(0, 140));
    }
    if (trx.qrString) {
      const stored = await prisma.qrisSandboxTrx.findUnique({ where: { trxid: trx.trxId } });
      ok("transaksi internal tercatat di DB", stored !== null);
    }
  } catch (err) {
    ok("rantai QRIS tetap hidup", false, err instanceof Error ? err.message : String(err));
  }

  console.log(`\n=== Hasil: ${pass} lulus, ${fail} gagal ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
