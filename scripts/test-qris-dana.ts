/**
 * Test integrasi QRIS DANA (QRIS Acquirer resmi) — end-to-end LOKAL.
 *
 * Menjalankan SERVER DANA MOCK di proses ini (meniru api.sandbox.dana.id:
 * Generate QRIS, Query Payment, Cancel, verifikasi signature merchant) lalu
 * menguji aplikasi dev (http://127.0.0.1:3000) lewat HTTP sungguhan:
 *
 *   1.  Buat QRIS  : GET /api/orders/:id/qris  -> provider "dana", QR dari DANA
 *   2.  Polling    : status PENDING -> setelah dana "masuk" -> PAID otomatis
 *   3.  Webhook    : Finish Notify TERTANDATANGANI DANA -> 2005600 -> pesanan LUNAS
 *                    - signature SALAH  -> 403 ditolak
 *                    - signature BENAR  -> diterima, markOrderPaidBySystem
 *   4.  Void admin : POST /api/admin/qris -> Cancel Order DANA + pesanan batal
 *   5.  Health     : GET/POST /api/qris-gateway/health -> probe DANA ok
 *   6.  Simulasi   : simulate-pay DITOLAK (404) saat penyedia nyata aktif
 *
 * Prasyarat (disiapkan scripts/run-dana-test.sh):
 *   - .env memuat DANA_CLIENT_ID/MERCHANT_ID/STORE_ID/PRIVATE_KEY/PUBLIC_KEY
 *     dan DANA_API_BASE=http://127.0.0.1:4653
 *   - dev server berjalan dengan env tersebut
 *   - kunci uji di /tmp/dana-test-keys (merchant + dana)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as rsaSign,
  verify as rsaVerify,
} from "crypto";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APP_BASE = process.env.APP_BASE ?? "http://127.0.0.1:3000";
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 4653);
const KEYS_DIR = process.env.KEYS_DIR ?? "/tmp/dana-test-keys";
const MERCHANT_PUB = readFileSync(`${KEYS_DIR}/merchant-public.pem`, "utf8");
const DANA_PRIV = readFileSync(`${KEYS_DIR}/dana-private.pem`, "utf8");

// ============================================================
//  Util SNAP (sama dengan implementasi aplikasi & DANA docs)
// ============================================================
function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function stringToSign(method: string, path: string, body: string, ts: string): string {
  return `${method}:${path}:${sha256Hex(body)}:${ts}`;
}
function jakartaTs(d: Date = new Date()): string {
  return `${d.toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).replace(" ", "T")}+07:00`;
}
function verifyMerchantSig(path: string, body: string, sigB64: string, ts: string): boolean {
  try {
    return rsaVerify(
      "sha256",
      Buffer.from(stringToSign("POST", path, body, ts), "utf8"),
      createPublicKey(MERCHANT_PUB),
      Buffer.from(sigB64, "base64")
    );
  } catch {
    return false;
  }
}
function danaSign(path: string, body: string, ts: string): string {
  const sts = stringToSign("POST", path, body, ts);
  return rsaSign("sha256", Buffer.from(sts, "utf8"), createPrivateKey(DANA_PRIV)).toString("base64");
}

// ============================================================
//  SERVER DANA MOCK — api.sandbox.dana.id palsu
// ============================================================
type Trx = { ref: string; amount: number; status: "PENDING" | "PAID" | "CANCELLED" };
const trxs = new Map<string, Trx>();

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const mock = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const path = new URL(req.url ?? "/", "http://mock").pathname;
  const sig = String(req.headers["x-signature"] ?? "");
  const ts = String(req.headers["x-timestamp"] ?? "");

  // Semua endpoint wajib signature merchant valid (persis perilaku DANA)
  if (!verifyMerchantSig(path, raw, sig, ts)) {
    json(res, 200, { responseCode: "4015000", responseMessage: "Invalid Signature" });
    return;
  }

  if (path === "/v1.0/qr/qr-mpm-generate.htm") {
    const b = JSON.parse(raw) as { partnerReferenceNo?: string; amount?: { value?: string } };
    const ref = String(b.partnerReferenceNo ?? "");
    if (!ref || trxs.has(ref)) {
      json(res, 200, {
        responseCode: "4018001",
        responseMessage: "Duplicate partnerReferenceNo",
      });
      return;
    }
    trxs.set(ref, { ref, amount: Math.round(Number(b.amount?.value ?? 0)), status: "PENDING" });
    json(res, 200, {
      responseCode: "2004700",
      responseMessage: "Successful",
      referenceNo: `DANA-REF-${Date.now()}`,
      partnerReferenceNo: ref,
      qrContent: `00020101021126MOCK-DANA-${ref}`,
      merchantName: "AGSI MOCK DANA",
    });
    return;
  }

  if (path === "/rest/v1.1/debit/status") {
    const b = JSON.parse(raw) as { originalPartnerReferenceNo?: string };
    const trx = trxs.get(String(b.originalPartnerReferenceNo ?? ""));
    json(res, 200, {
      responseCode: "2005500",
      responseMessage: "Successful",
      originalPartnerReferenceNo: String(b.originalPartnerReferenceNo ?? ""),
      latestTransactionStatus:
        trx?.status === "PAID" ? "00" : trx ? "01" : "07",
      transactionStatusDesc: trx?.status === "PAID" ? "success" : "initiated",
    });
    return;
  }

  if (path === "/v1.0/debit/cancel.htm") {
    const b = JSON.parse(raw) as { originalPartnerReferenceNo?: string };
    const trx = trxs.get(String(b.originalPartnerReferenceNo ?? ""));
    if (trx && trx.status === "PENDING") trx.status = "CANCELLED";
    json(res, 200, { responseCode: "2005700", responseMessage: "Successful" });
    return;
  }

  json(res, 404, { responseCode: "4004000", responseMessage: "Not Found" });
});

// ============================================================
//  "Aplikasi DANA" — bayar transaksi + kirim Finish Notify ke aplikasi
// ============================================================
async function danaPayAndNotify(ref: string, tamper = false) {
  const trx = trxs.get(ref);
  if (trx && trx.status === "PENDING") trx.status = "PAID";
  const ts = jakartaTs();
  const body = JSON.stringify({
    originalPartnerReferenceNo: ref,
    originalReferenceNo: `DANA-REF-${Date.now()}`,
    merchantId: "216660000274111177110",
    amount: { value: `${(trx?.amount ?? 0).toFixed(2)}`, currency: "IDR" },
    latestTransactionStatus: "00",
    transactionStatusDesc: "success",
    createdTime: ts,
    finishedTime: ts,
    additionalInfo: { paymentInfo: { paidTime: ts, payOptionInfos: [{ payMethod: "BALANCE" }] } },
  });
  const path = "/api/webhooks/qris";
  let sig = danaSign(path, body, ts);
  if (tamper) sig = `${sig.slice(0, 10)}AAAA${sig.slice(14)}`;
  const res = await fetch(`${APP_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SIGNATURE": sig,
      "X-TIMESTAMP": ts,
      "X-PARTNER-ID": "TEST-CLIENT-ID",
      "X-EXTERNAL-ID": randomUUID(),
      "CHANNEL-ID": "95221",
    },
    body,
  });
  return { httpStatus: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Dana masuk TANPA webhook — untuk menguji jalur POLLING murni */
function danaPaySilent(ref: string) {
  const trx = trxs.get(ref);
  if (trx && trx.status === "PENDING") trx.status = "PAID";
}

// ============================================================
//  Helper HTTP aplikasi
// ============================================================
async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const res = await fetch(`${APP_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    cache: "no-store",
  });
  return { httpStatus: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✕ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  await new Promise<void>((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));
  console.log(`[MOCK] DANA API mock jalan di http://127.0.0.1:${MOCK_PORT}`);

  // ===== Login =====
  const cust = await api("/api/auth/login", {
    method: "POST",
    body: { email: "budi@example.com", password: "user123" },
  });
  const custToken = String(cust.body.token ?? "");
  check("Login pelanggan (budi@example.com)", cust.httpStatus === 200 && custToken.length > 10);

  const admin = await api("/api/auth/login", {
    method: "POST",
    body: { email: "owner@agsi.test", password: "owner123" },
  });
  const adminToken = String(admin.body.token ?? "");
  check("Login owner (owner@agsi.test)", admin.httpStatus === 200 && adminToken.length > 10);

  const product = await db.product.findFirst({ orderBy: { id: "asc" } });
  if (!product) throw new Error("Produk seed tidak ada — jalankan scripts/seed.ts dulu.");

  const mkOrder = async () => {
    const r = await api("/api/orders", {
      method: "POST",
      token: custToken,
      body: {
        items: [{ productId: product.id, qty: 1, note: "" }],
        type: "TAKEAWAY",
        paymentMethod: "QRIS",
        source: "APP",
      },
    });
    return r.body.order as { id: string; code: string; total: number } | undefined;
  };

  // ===== 1) Buat QRIS via DANA =====
  console.log("\n[1] Generate QRIS via API DANA (mock)");
  const o1 = await mkOrder();
  check("Pesanan 1 dibuat", !!o1);
  const q1 = o1 ? await api(`/api/orders/${o1.id}/qris`, { token: custToken }) : null;
  const q1Body = (q1?.body ?? {}) as Record<string, unknown>;
  check("GET qris 200", q1?.httpStatus === 200);
  check('provider === "dana"', q1Body.provider === "dana", String(q1Body.provider));
  check("mode GATEWAY + autoVerify", q1Body.mode === "GATEWAY" && q1Body.autoVerify === true);
  check("payload QR dari DANA mock", String(q1Body.payload ?? "").startsWith("00020101021126MOCK-DANA"));
  check("trxId berprefix DANA- (≤25 char)", String(q1Body.trxId ?? "").startsWith("DANA-") && String(q1Body.trxId).length <= 25, String(q1Body.trxId));
  check("sandbox=false (bukan gateway bawaan)", q1Body.sandbox === false);
  const ref1 = String(q1Body.trxId ?? "");
  check("transaksi tercatat di DANA mock (amount pas)", trxs.get(ref1)?.amount === o1?.total, `${trxs.get(ref1)?.amount} vs ${o1?.total}`);

  // ===== 2) Status awal PENDING =====
  console.log("\n[2] Polling status awal");
  const s0 = await api(`/api/orders/${o1!.id}/qris/status?force=1`, { token: custToken });
  check("gatewayStatus PENDING", s0.body.gatewayStatus === "PENDING", JSON.stringify(s0.body));

  // ===== 3) Webhook TERTANDATANGANI =====
  console.log("\n[3] Finish Notify DANA (webhook)");
  const bad = await danaPayAndNotify(ref1, true);
  check("Signature SALAH -> 403", bad.httpStatus === 403, JSON.stringify(bad.body));
  const st1 = await api(`/api/orders/${o1!.id}`, { token: custToken });
  const afterBad = (st1.body.order as { paymentStatus?: string })?.paymentStatus;
  check("Pesanan BELUM lunas setelah webhook palsu", afterBad !== "PAID", String(afterBad));

  const good = await danaPayAndNotify(ref1);
  check("Signature BENAR -> 200 + responseCode 2005600", good.httpStatus === 200 && good.body.responseCode === "2005600", JSON.stringify(good.body));
  const st2 = await api(`/api/orders/${o1!.id}`, { token: custToken });
  const paid1 = st2.body.order as { paymentStatus?: string; paidVia?: string; status?: string };
  check("Pesanan LUNAS otomatis", paid1.paymentStatus === "PAID", String(paid1.paymentStatus));
  check('paidVia === "AUTO"', paid1.paidVia === "AUTO", String(paid1.paidVia));
  check("Masuk dapur (PREPARING)", paid1.status === "PREPARING", String(paid1.status));

  // ===== 4) Jalur POLLING murni =====
  console.log("\n[4] Polling murni tanpa webhook");
  const o2 = await mkOrder();
  const q2 = o2 ? await api(`/api/orders/${o2.id}/qris`, { token: custToken }) : null;
  const ref2 = String(q2?.body.trxId ?? "");
  check("Pesanan 2 QRIS dibuat", !!ref2);
  danaPaySilent(ref2);
  const s1 = await api(`/api/orders/${o2!.id}/qris/status?force=1`, { token: custToken });
  check("Polling menemukan dana masuk -> PAID", s1.body.paymentStatus === "PAID", JSON.stringify(s1.body));
  check("paidVia AUTO via polling", s1.body.paidVia === "AUTO");

  // ===== 5) Simulate-pay DITOLAK =====
  console.log("\n[5] Guard simulasi");
  const o3 = await mkOrder();
  await api(`/api/orders/${o3!.id}/qris`, { token: custToken });
  const sim = await api(`/api/orders/${o3!.id}/qris/simulate-pay`, { method: "POST", token: custToken });
  check("simulate-pay 404 saat penyedia nyata aktif", sim.httpStatus === 404, JSON.stringify(sim.body));

  // ===== 6) Void admin (Cancel Order DANA) =====
  console.log("\n[6] Void admin -> Cancel Order DANA");
  const ref3 = String((await api(`/api/orders/${o3!.id}/qris`, { token: custToken })).body.trxId ?? "");
  const voidR = await api("/api/admin/qris", { method: "POST", token: adminToken, body: { orderId: o3!.id } });
  check("Void ok", voidR.httpStatus === 200 && voidR.body.ok === true, JSON.stringify(voidR.body));
  const st3 = await api(`/api/orders/${o3!.id}`, { token: custToken });
  check("Pesanan CANCELLED", (st3.body.order as { status?: string })?.status === "CANCELLED");
  check("Transaksi pesanan 3 batal di penyedia (mock)", trxs.get(ref3)?.status === "CANCELLED", String(trxs.get(ref3)?.status));

  // ===== 7) Health & probe charge DANA =====
  console.log("\n[7] Health admin");
  const h = await api("/api/qris-gateway/health", { token: adminToken });
  const hCfg = h.body.config as Record<string, Record<string, unknown>> | undefined;
  check("config.dana.enabled true", hCfg?.dana?.enabled === true);
  check("danaProbe AUTENTIKASI_OK", (h.body.danaProbe as { verdict?: string })?.verdict === "AUTENTIKASI_OK", JSON.stringify(h.body.danaProbe));
  check('activeProvider "dana"', h.body.activeProvider === "dana", String(h.body.activeProvider));
  const hp = await api("/api/qris-gateway/health", { method: "POST", token: adminToken });
  check("Probe charge DANA SIAP", hp.body.ok === true && String(hp.body.verdict).includes("SIAP"), JSON.stringify(hp.body));

  // ===== Ringkasan =====
  console.log(`\n===== HASIL: ${passed} lulus, ${failed} gagal =====`);
  if (failed > 0) process.exitCode = 1;
  await db.$disconnect();
  mock.close();
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  await db.$disconnect();
  mock.close();
  process.exit(1);
});
