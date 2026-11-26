/**
 * doku-mock.mjs — Mock server DOKU Checkout legacy untuk e2e lokal.
 * Endpoint (api.doku.com-compatible):
 *   POST /checkout/v1/payment          → buat checkout (kembalikan payment.url)
 *   GET  /orders/v1/status/{invoice}   → status transaksi (PENDING/SUCCESS)
 *   POST /mock/pay {invoice}           → tandai invoice LUNAS (uji polling)
 *   GET  /mock/state                   → dump invoice tercatat (uji asersi)
 */
import { createServer } from "http";

const invoices = new Map(); // invoice → { amount, status, channelTypes, url }
let seq = 0;

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  if (req.method === "POST" && url.pathname === "/checkout/v1/payment") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const invoice = body?.order?.invoice_number ?? `MOCK-${++seq}`;
    const rec = {
      amount: body?.order?.amount ?? 0,
      status: "PENDING",
      channelTypes: body?.payment?.payment_method_types ?? null,
      url: `https://checkout.doku.com/checkout-link-v2/MOCK-${invoice}`,
    };
    invoices.set(invoice, rec);
    return json(res, 200, {
      message: "SUCCESS",
      response: {
        order: { invoice_number: invoice, amount: rec.amount, currency: "IDR" },
        payment: {
          payment_method_types: rec.channelTypes ?? [],
          payment_due_date: body?.payment?.payment_due_date ?? 5,
          token_id: `TKN-${invoice}`,
          url: rec.url,
          expired_datetime: new Date(Date.now() + 5 * 60_000).toISOString(),
        },
        customer: body?.customer ?? {},
        additional_info: {},
        uuid: `U-${invoice}`,
        headers: {},
      },
    });
  }
  if (req.method === "GET" && url.pathname.startsWith("/orders/v1/status/")) {
    const invoice = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const rec = invoices.get(invoice);
    if (!rec) return json(res, 404, { message: "Invoice not found" });
    const paid = rec.status === "SUCCESS";
    return json(res, 200, {
      order: { invoice_number: invoice, amount: rec.amount, status: paid ? "ORDER_PAID" : "ORDER_GENERATED" },
      transaction: { status: paid ? "SUCCESS" : "PENDING", date: new Date().toISOString() },
      service: { id: "" },
      acquirer: { id: "" },
      channel: { id: "" },
    });
  }
  if (req.method === "POST" && url.pathname === "/mock/pay") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const rec = invoices.get(body?.invoice);
    if (!rec) return json(res, 404, { ok: false });
    rec.status = "SUCCESS";
    return json(res, 200, { ok: true, invoice: body?.invoice });
  }
  if (req.method === "GET" && url.pathname === "/mock/state") {
    return json(res, 200, {
      invoices: [...invoices.entries()].map(([inv, r]) => ({
        invoice: inv,
        amount: r.amount,
        status: r.status,
        channelTypes: r.channelTypes,
        url: r.url,
      })),
    });
  }
  json(res, 404, { message: "not found" });
}).listen(3990, () => console.log("DOKU mock siap di :3990"));
