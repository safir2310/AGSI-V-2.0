/**
 * Probe kredensial DOKU produksi — server-to-server, TANPA efek pembayaran
 * (generate QRIS tidak memotong dana apa pun; hanya QR string).
 *
 *   bun scripts/probe-doku-creds.ts
 *
 * Yang diuji (semua nilai rahasia TIDAK dicetak):
 *   1. Token B2B  POST /authorization/v1/access-token/b2b
 *      (produksi api.doku.com + sandbox api-sandbox.doku.com)
 *   2. Generate QRIS POST /snap-adapter/b2b/v1.0/qr/qr-mpm-generate
 *      dengan kandidat merchantId: Client-ID dan string kosong
 *   3. MCP DOKU: tools/list + tools/call create_qris_payment (Rp1.000)
 *      di base produksi & sandbox (jalur API key agentic)
 *   4. Sanity: PEM DOKU_PUBLIC_KEY dapat diurai Node crypto
 */
import { createHash, createHmac, createPublicKey } from "crypto";

const CLIENT_ID = (process.env.DOKU_CLIENT_ID ?? "").trim();
const CLIENT_SECRET = (process.env.DOKU_CLIENT_SECRET ?? "").trim();
const API_KEY = (process.env.DOKU_API_KEY ?? "").trim();
const PUBLIC_KEY_PEM = (process.env.DOKU_PUBLIC_KEY ?? "").replace(/\\n/g, "\n");

const BASE_PROD = "https://api.doku.com";
const BASE_SANDBOX = "https://api-sandbox.doku.com";

function wibTimestamp(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+07:00`;
}
function hmac512(secret: string, s: string): string {
  return createHmac("sha512", secret).update(s).digest("base64");
}
function externalId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
}
function mask(s: string, keep = 8): string {
  return s.length <= keep ? "***" : `${s.slice(0, keep)}…(${s.length}ch)`;
}

// ============================================================
// 1) Token B2B
// ============================================================
async function getToken(
  base: string
): Promise<{ ok: boolean; httpStatus: number; token?: string; body: Record<string, unknown> }> {
  const path = "/authorization/v1/access-token/b2b";
  const timestamp = wibTimestamp();
  const signature = hmac512(CLIENT_SECRET, `${CLIENT_ID}|${timestamp}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": CLIENT_ID,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
      },
      body: JSON.stringify({ grantType: "client_credentials" }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const token = typeof body.accessToken === "string" ? body.accessToken : undefined;
    return { ok: res.ok && !!token, httpStatus: res.status, token, body };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      body: { error: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// 2) Generate QRIS (merchantId kandidat)
// ============================================================
async function generateQris(
  base: string,
  token: string,
  merchantId: string
): Promise<{ ok: boolean; httpStatus: number; body: Record<string, unknown> }> {
  const path = "/snap-adapter/b2b/v1.0/qr/qr-mpm-generate";
  const timestamp = wibTimestamp();
  const validity = wibTimestamp(new Date(Date.now() + 5 * 60_000));
  const payload = {
    partnerReferenceNo: `PROBE-${Date.now()}`,
    amount: { value: "1000.00", currency: "IDR" },
    merchantId,
    terminalId: "A01",
    validityPeriod: validity,
    additionalInfo: { postalCode: "13120", feeType: "1" },
  };
  const minified = JSON.stringify(payload);
  const bodyHash = createHash("sha256").update(minified).digest("hex").toLowerCase();
  const signature = hmac512(
    CLIENT_SECRET,
    `POST:${path}:${token}:${bodyHash}:${timestamp}`
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-PARTNER-ID": CLIENT_ID,
        "X-EXTERNAL-ID": externalId(),
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        Authorization: `Bearer ${token}`,
        "CHANNEL-ID": "H2H",
      },
      body: minified,
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, httpStatus: res.status, body };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      body: { error: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// 3) MCP DOKU (jalur API key agentic)
// ============================================================
async function mcpCall(
  base: string,
  toolName: string,
  toolRequest: Record<string, unknown> | null
): Promise<{ ok: boolean; httpStatus: number; raw: string }> {
  const basic = Buffer.from(`${API_KEY}:`).toString("base64");
  const payload = toolRequest
    ? {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: toolName, arguments: { toolRequest } },
      }
    : { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${base}/doku-mcp-server/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await res.text();
    return { ok: res.ok, httpStatus: res.status, raw };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      raw: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function firstText(raw: string): string {
  // MCP respons bisa JSON murni atau SSE ("data: {...}") — ambil teks konten
  try {
    const j = JSON.parse(raw.trim().startsWith("data:") ? raw.trim().slice(5) : raw) as {
      result?: { content?: { text?: string }[] };
    };
    const t = j.result?.content?.[0]?.text;
    return t ? t.slice(0, 300) : raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("=== PROBE KREDENSIAL DOKU ===");
  console.log(`CLIENT_ID : ${CLIENT_ID || "(kosong)"}`);
  console.log(`SECRET    : ${CLIENT_SECRET ? mask(CLIENT_SECRET) : "(kosong)"}`);
  console.log(`API_KEY   : ${API_KEY ? mask(API_KEY) : "(kosong)"}`);

  // [0] Sanity PEM publik
  console.log("\n[0] Sanity PEM DOKU_PUBLIC_KEY");
  try {
    const key = createPublicKey(PUBLIC_KEY_PEM);
    const pemOut = key.export({ type: "spki", format: "pem" }).toString();
    console.log(`  ✅ PEM valid (${pemOut.split("\n").length} baris, RSA=${key.asymmetricKeyType})`);
  } catch (err) {
    console.log(`  ❌ PEM tidak valid: ${err instanceof Error ? err.message : err}`);
  }

  for (const [label, base] of [
    ["PRODUKSI", BASE_PROD],
    ["SANDBOX", BASE_SANDBOX],
  ] as const) {
    console.log(`\n=== ${label} (${base}) ===`);

    // [1] Token
    const tk = await getToken(base);
    console.log(
      `[1] Token B2B: HTTP ${tk.httpStatus} ${tk.ok ? "✅ OK" : "❌"} ${JSON.stringify(tk.body).slice(0, 200)}`
    );
    if (!tk.ok) continue;

    // [2] Generate QRIS — merchantId kandidat
    for (const mid of [CLIENT_ID, ""]) {
      const g = await generateQris(base, tk.token!, mid);
      const qr =
        typeof g.body.qrContent === "string"
          ? `qrContent=${(g.body.qrContent as string).slice(0, 40)}…`
          : JSON.stringify(g.body).slice(0, 220);
      console.log(
        `[2] Generate (merchantId=${mid ? `"${mid.slice(0, 12)}…"` : "(kosong)"}): HTTP ${g.httpStatus} ${g.ok ? "✅" : "❌"} ${qr}`
      );
      if (g.ok) {
        // [3] Query status transaksi barusan
        const ref = `PROBE-${Date.now()}`;
        void ref;
        console.log("    -> QRIS GENERATE BERHASIL dengan merchantId ini");
        break;
      }
    }

    // [4] MCP
    const ml = await mcpCall(base, "tools/list", null);
    console.log(
      `[4] MCP tools/list: HTTP ${ml.httpStatus} ${ml.ok ? "✅" : "❌"} ${firstText(ml.raw).slice(0, 120)}`
    );
    if (ml.ok) {
      const mc = await mcpCall(base, "create_qris_payment", {
        amount: "1000.00",
        partnerReferenceNo: `PROBE-MCP-${Date.now()}`,
        postalCode: "13120",
        validityPeriod: wibTimestamp(new Date(Date.now() + 5 * 60_000)),
      });
      console.log(
        `[4b] MCP create_qris_payment: HTTP ${mc.httpStatus} ${mc.ok ? "✅" : "❌"} ${firstText(mc.raw).slice(0, 200)}`
      );
    }
  }

  console.log("\n=== PROBE SELESAI ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
