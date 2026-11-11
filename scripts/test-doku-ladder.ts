/**
 * Uji TANGGA KANAL checkoutCreateQris (src/lib/qris-doku.ts) — fetch
 * dipalsu, tanpa kredensial/jaringan. Memastikan perbaikan HTTP 400
 * "PAYMENT CHANNEL IS INACTIVE" berperilaku tepat:
 *
 *   A. ["QRIS"] ditolak -> filter e-wallet ditolak -> tanpa filter sukses
 *      (fallbackReason = catatan tingkat yang berhasil, URL halaman bayar ada).
 *   B. Pesan varian lama "PLEASE USE ANOTHER PAYMENT METHOD" turut tertangkap.
 *   C. Invoice duplikat -> suffix unik pada TINGKAT FILTER SAMA (bukan turun tangga).
 *   D. Galat 401 TIDAK menuruni tangga — dilempar apa adanya (1 panggilan saja).
 *   E. Semua tingkat ditolak -> galat akhir memuat panduan aktivasi (3 panggilan).
 *
 *   bun scripts/test-doku-ladder.ts
 */
process.env.DOKU_CLIENT_ID = "TEST-CLIENT-ID";
process.env.DOKU_CLIENT_SECRET = "test-secret";
process.env.DOKU_IS_PRODUCTION = "false";

const { createQrisDokuPayment } = await import("../src/lib/qris-doku");
const { DOKU_EWALLET_CHANNEL_TYPES } = await import("../src/lib/qris-doku");

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

type RecordedCall = { filter: string[] | undefined; invoice: string };
let calls: RecordedCall[] = [];

type Responder = (callIndex: number, filter: string[] | undefined, invoice: string) => Response;
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Pasang fetch palsu dengan skenario tertentu */
function mockFetch(respond: Responder) {
  calls = [];
  (globalThis as { fetch: unknown }).fetch = (async (
    _url: string | URL,
    init: { method?: string; body?: string }
  ) => {
    const payload = JSON.parse(init.body ?? "{}") as {
      payment?: { payment_method_types?: string[] };
      order?: { invoice_number?: string };
    };
    const filter = payload.payment?.payment_method_types;
    const invoice = payload.order?.invoice_number ?? "";
    calls.push({ filter, invoice });
    return respond(calls.length, filter, invoice);
  }) as typeof fetch;
}

const dokuReject = (message: string) =>
  json(400, { error: { message } });
const checkoutOk = () =>
  json(200, {
    response: {
      order: { invoice_number: "x", amount: 10000 },
      payment: { url: "https://checkout.doku.com/pay/TEST-123" },
    },
  });

async function run(name: string, fn: () => Promise<void>) {
  console.log(`\n[${name}]`);
  try {
    await fn();
  } catch (err) {
    ok(name, false, err instanceof Error ? err.message : String(err));
  }
}

await run("A. QRIS ditolak -> e-wallet ditolak -> tanpa filter sukses", async () => {
  mockFetch((_i, filter) => {
    if (filter && filter.length === 1 && filter[0] === "QRIS") return dokuReject("PAYMENT CHANNEL IS INACTIVE");
    if (filter && filter.length > 1) return dokuReject("PAYMENT CHANNEL IS INACTIVE");
    return checkoutOk();
  });
  const trx = await createQrisDokuPayment({
    amount: 10000,
    reference: "TEST-LADDER-A",
    channelMode: "QRIS",
    callbackRef: "ord_a",
  });
  ok("3 panggilan (QRIS, e-wallet, tanpa filter)", calls.length === 3, `n=${calls.length}`);
  ok("panggilan 1 filter [QRIS]", JSON.stringify(calls[0]?.filter) === JSON.stringify(["QRIS"]));
  ok(
    "panggilan 2 filter e-wallet",
    JSON.stringify(calls[1]?.filter) === JSON.stringify(DOKU_EWALLET_CHANNEL_TYPES)
  );
  ok("panggilan 3 tanpa filter", calls[2]?.filter === undefined);
  ok("URL halaman bayar dikembalikan", trx.paymentUrl === "https://checkout.doku.com/pay/TEST-123");
  ok(
    "fallbackReason = catatan tingkat tanpa-filter",
    (trx.fallbackReason ?? "").includes("semua kanal aktif"),
    trx.fallbackReason?.slice(0, 80)
  );
  ok("trxId prefix DOKU-", trx.trxId.startsWith("DOKU-TEST-LADDER-A"));
});

await run("B. Pesan varian lama 'PLEASE USE ANOTHER PAYMENT METHOD' tertangkap", async () => {
  mockFetch((_i, filter) => {
    if (filter && filter.length === 1 && filter[0] === "QRIS")
      return dokuReject("PLEASE USE ANOTHER PAYMENT METHOD");
    return checkoutOk();
  });
  const trx = await createQrisDokuPayment({
    amount: 10000,
    reference: "TEST-LADDER-B",
    channelMode: "QRIS",
  });
  ok("2 panggilan (QRIS lalu e-wallet sukses)", calls.length === 2, `n=${calls.length}`);
  ok(
    "fallbackReason = catatan tingkat e-wallet",
    (trx.fallbackReason ?? "").includes("Kanal QRIS akun DOKU belum aktif"),
    trx.fallbackReason?.slice(0, 80)
  );
});

await run("C. Invoice duplikat -> suffix unik pada tingkat filter SAMA", async () => {
  mockFetch((i, filter) => {
    if (i === 1) return dokuReject("DUPLICATE_INVOICE_NUMBER");
    return checkoutOk();
  });
  const trx = await createQrisDokuPayment({
    amount: 10000,
    reference: "TEST-LADDER-C",
    channelMode: "QRIS",
  });
  ok("2 panggilan", calls.length === 2, `n=${calls.length}`);
  ok("kedua panggilan masih filter [QRIS]", calls.every((c) => JSON.stringify(c.filter) === JSON.stringify(["QRIS"])));
  ok("invoice kedua berbeda (suffix unik)", calls[0]?.invoice !== calls[1]?.invoice, `${calls[0]?.invoice} -> ${calls[1]?.invoice}`);
  ok("tanpa fallbackReason (sukses di tingkat diminta)", trx.fallbackReason === undefined, trx.fallbackReason ?? "null");
});

await run("D. Galat 401 tidak menuruni tangga", async () => {
  mockFetch(() => json(401, { error: { message: "Unauthorized. Invalid Client-Id or Secret" } }));
  let thrown: Error | null = null;
  try {
    await createQrisDokuPayment({ amount: 10000, reference: "TEST-LADDER-D", channelMode: "QRIS" });
  } catch (err) {
    thrown = err instanceof Error ? err : null;
  }
  ok("galat dilempar", thrown !== null, thrown?.message);
  ok("hanya 1 panggilan (tidak turun tangga)", calls.length === 1, `n=${calls.length}`);
});

await run("E. Semua tingkat ditolak -> galat akhir memuat panduan aktivasi", async () => {
  mockFetch(() => dokuReject("PAYMENT CHANNEL IS INACTIVE"));
  let thrown: Error | null = null;
  try {
    await createQrisDokuPayment({ amount: 10000, reference: "TEST-LADDER-E", channelMode: "QRIS" });
  } catch (err) {
    thrown = err instanceof Error ? err : null;
  }
  ok("galat dilempar", thrown !== null, thrown?.message?.slice(0, 120));
  ok("3 panggilan (QRIS, e-wallet, tanpa filter)", calls.length === 3, `n=${calls.length}`);
  ok(
    "pesan memuat panduan aktivasi",
    (thrown?.message ?? "").includes("Kanal pembayaran akun DOKU belum aktif"),
    thrown?.message.slice(0, 140)
  );
});

await run("F. EWALLET ditolak -> tanpa filter sukses (tanpa tingkat QRIS)", async () => {
  mockFetch((_i, filter) => {
    if (filter && filter.length > 1) return dokuReject("PAYMENT CHANNEL IS INACTIVE");
    return checkoutOk();
  });
  const trx = await createQrisDokuPayment({
    amount: 25000,
    reference: "TEST-LADDER-F",
    channelMode: "EWALLET",
  });
  ok("2 panggilan", calls.length === 2, `n=${calls.length}`);
  ok("panggilan 1 = daftar e-wallet", JSON.stringify(calls[0]?.filter) === JSON.stringify(DOKU_EWALLET_CHANNEL_TYPES));
  ok("panggilan 2 tanpa filter", calls[1]?.filter === undefined);
  ok(
    "fallbackReason = catatan tingkat tanpa-filter",
    (trx.fallbackReason ?? "").includes("semua kanal aktif"),
    trx.fallbackReason?.slice(0, 80)
  );
});

console.log(`\n=== Hasil: ${pass} lulus, ${fail} gagal ===`);
process.exit(fail > 0 ? 1 : 0);
