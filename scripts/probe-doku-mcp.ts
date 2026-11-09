/**
 * Probe MCP DOKU (jalur API key agentic) — independen dari jalur SNAP.
 * Uji tools/list + create_qris_payment (Rp1.000) di base produksi & sandbox.
 */
const API_KEY = (process.env.DOKU_API_KEY ?? "").trim();
const BASES = [
  ["PRODUKSI", "https://api.doku.com"],
  ["SANDBOX", "https://api-sandbox.doku.com"],
] as const;

function wibTimestamp(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+07:00`;
}

async function mcpCall(
  base: string,
  method: string,
  params: Record<string, unknown>
): Promise<{ httpStatus: number; raw: string }> {
  const basic = Buffer.from(`${API_KEY}:`).toString("base64");
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
      signal: controller.signal,
    });
    return { httpStatus: res.status, raw: await res.text() };
  } catch (err) {
    return { httpStatus: 0, raw: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function summarize(raw: string): string {
  const t = raw.trim();
  try {
    const j = JSON.parse(t.startsWith("data:") ? t.slice(5) : t) as {
      result?: { content?: { text?: string }[]; tools?: { name?: string }[] };
    };
    if (j.result?.tools) {
      const names = j.result.tools.map((x) => x.name).filter(Boolean);
      return `tools(${names.length}): ${names.join(", ").slice(0, 400)}`;
    }
    const inner = j.result?.content?.[0]?.text;
    return inner ? inner.slice(0, 400) : t.slice(0, 400);
  } catch {
    return t.slice(0, 400);
  }
}

async function main() {
  for (const [label, base] of BASES) {
    console.log(`\n=== ${label} (${base}) ===`);
    const list = await mcpCall(base, "tools/list", {});
    console.log(`tools/list: HTTP ${list.httpStatus}\n  ${summarize(list.raw)}`);
    const create = await mcpCall(base, "tools/call", {
      name: "create_qris_payment",
      arguments: {
        toolRequest: {
          amount: "1000.00",
          partnerReferenceNo: `PROBE-MCP-${Date.now()}`,
          postalCode: "13120",
          validityPeriod: wibTimestamp(new Date(Date.now() + 5 * 60_000)),
        },
      },
    });
    console.log(`create_qris_payment: HTTP ${create.httpStatus}\n  ${summarize(create.raw)}`);
  }
  console.log("\n=== PROBE MCP SELESAI ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
