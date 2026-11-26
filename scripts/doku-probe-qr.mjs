/**
 * doku-probe-qr.mjs — PROBE nyata API DOKU produksi:
 * apakah Checkout API mengembalikan STRING QRIS EMVCo asli
 * (bisa dirender QR di aplikasi) untuk filter kanal ["QRIS"],
 * dan bagaimana bentuk respons tanpa filter (semua kanal)?
 * Transaksi uji: Rp 10.000, kedaluwarsa 5 menit — tidak dibayar, hangus sendiri.
 * SEKRET DISAMARKAN — hanya client id terpotong yang dicetak.
 */
import { createHash, createHmac } from "crypto";
import { readFileSync } from "fs";

const VT = readFileSync("scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const BASE = "https://api.doku.com";

async function envValue(key) {
  const list = await fetch(
    `https://api.vercel.com/v10/projects/agsi-v-2-0/env?teamId=${TEAM}`,
    { headers: { Authorization: `Bearer ${VT}` } }
  ).then((r) => r.json());
  const e = (list.envs ?? []).find(
    (x) => x.key === key && x.target?.includes("production")
  );
  if (!e) throw new Error(`${key} tidak diset`);
  const v = await fetch(
    `https://api.vercel.com/v10/projects/agsi-v-2-0/env/${e.id}?decrypt=true&teamId=${TEAM}`,
    { headers: { Authorization: `Bearer ${VT}` } }
  ).then((r) => r.json());
  return v.value;
}

const CLIENT_ID = (await envValue("DOKU_CLIENT_ID")).trim();
const CLIENT_SECRET = (await envValue("DOKU_CLIENT_SECRET")).trim();
console.log(`Client-Id: ${CLIENT_ID.slice(0, 6)}…(${CLIENT_ID.length} char), secret: ${CLIENT_SECRET.slice(0, 3)}…(${CLIENT_SECRET.length} char)`);

function headers(target, bodyRaw) {
  const requestId = `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const parts = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${ts}`,
    `Request-Target:${target}`,
  ];
  if (bodyRaw !== null) {
    parts.push(`Digest:${createHash("sha256").update(bodyRaw).digest("base64")}`);
  }
  return {
    "Client-Id": CLIENT_ID,
    "Request-Id": requestId,
    "Request-Timestamp": ts,
    "Request-Target": target,
    Signature: `HMACSHA256=${createHmac("sha256", CLIENT_SECRET).update(parts.join("\n")).digest("base64")}`,
    ...(bodyRaw !== null ? { "Content-Type": "application/json" } : {}),
  };
}

async function post(path, payload) {
  const raw = JSON.stringify(payload);
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: headers(path, raw),
    body: raw,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: headers(path, null) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function summarize(tag, json) {
  console.log(`\n===== ${tag} =====`);
  const flat = JSON.stringify(json);
  // Cari string QRIS EMVCo di mana pun
  const qrHits = [];
  const walk = (v, path) => {
    if (v == null || typeof v !== "object") {
      if (typeof v === "string") {
        if (v.startsWith("000201") || v.includes("ID.CO.QRIS.WWW"))
          qrHits.push({ path, value: v.slice(0, 60) + `…(len ${v.length})` });
      }
      return;
    }
    for (const [k, val] of Object.entries(v)) walk(val, `${path}.${k}`);
  };
  walk(json, "$");
  console.log("Kunci level-1:", Object.keys(json).join(", "));
  if (json.response) console.log("response.*:", Object.keys(json.response).join(", "));
  if (json.response?.payment) console.log("response.payment.*:", Object.keys(json.response.payment).join(", "));
  if (qrHits.length) {
    console.log(">>> STRING QRIS DITEMUKAN:");
    for (const h of qrHits) console.log(`    ${h.path} = ${h.value}`);
  } else {
    console.log(">>> tidak ada string QRIS EMVCo di respons");
    // tampilkan field yang mengandung 'qr' (nama kunci)
    const qrKeys = [];
    const walkK = (v, path) => {
      if (v == null || typeof v !== "object") return;
      for (const [k, val] of Object.entries(v)) {
        if (/qr/i.test(k)) qrKeys.push(`${path}.${k} = ${JSON.stringify(val)?.slice(0, 120)}`);
        walkK(val, `${path}.${k}`);
      }
    };
    walkK(json, "$");
    console.log(qrKeys.length ? "Kunci mengandung 'qr':" : "(tidak ada kunci 'qr' sama sekali)");
    for (const k of qrKeys) console.log("    " + k);
  }
  const url = json.response?.payment?.url ?? json.payment?.url;
  if (url) console.log("payment.url:", url);
}

const ts = Date.now().toString(36);
const basePayload = (invoice, channelTypes) => ({
  order: {
    invoice_number: invoice,
    amount: 10000,
    currency: "IDR",
    callback_url: "https://agsi-v-2-0.vercel.app/",
    language: "id",
    line_items: [{ name: "Probe QRIS DOKU", quantity: 1, price: 10000 }],
  },
  payment: {
    payment_due_date: 5,
    enable_saves: false,
    enable_paylater: false,
    ...(channelTypes ? { payment_method_types: channelTypes } : {}),
  },
  customer: { name: "Probe Uji", email: "pos@agsi.co.id" },
});

// 1) Filter QRIS saja
const inv1 = `DOKU-QRPROBE-${ts}-Q`;
const r1 = await post("/checkout/v1/payment", basePayload(inv1, ["QRIS"]));
console.log(`\n[QRIS-only] HTTP ${r1.status}`);
summarize("RESPONS QRIS-ONLY", r1.json);

// 2) Tanpa filter (semua kanal)
const inv2 = `DOKU-QRPROBE-${ts}-A`;
const r2 = await post("/checkout/v1/payment", basePayload(inv2, null));
console.log(`\n[ALL] HTTP ${r2.status}`);
summarize("RESPONS ALL-METHODS", r2.json);

// 3) Status kedua invoice
for (const inv of [inv1, inv2]) {
  const s = await get(`/orders/v1/status/${encodeURIComponent(inv)}`);
  console.log(`\n[status ${inv}] HTTP ${s.status} →`, JSON.stringify(s.json).slice(0, 400));
}
