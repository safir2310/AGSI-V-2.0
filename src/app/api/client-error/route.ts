import { NextRequest, NextResponse } from "next/server";

/**
 * LAPORAN ERROR KLIEN (v1.3.18) — web & aplikasi Android melaporkan
 * "Application error" otomatis ke sini supaya pemilik tidak perlu menyalin
 * pesan error manual. In-memory per-instance (cukup untuk diagnostik; tanpa
 * tabel baru di DB).
 *
 *  POST /api/client-error  { detail, url? }  — simpan laporan (throttle klien)
 *  GET  /api/client-error?key=…            — lihat laporan terbaru (kunci diag)
 */

const DIAG_KEY = process.env.CLIENT_ERROR_KEY?.trim() || "agsi-diag-2026-x7";
const MAX_ROWS = 50;

type ErrorRow = {
  id: number;
  ts: string;
  app_version: string;
  ua: string;
  detail: string;
};

const g = globalThis as unknown as { __agsiClientErrors?: ErrorRow[] };
const rows: ErrorRow[] = (g.__agsiClientErrors ??= []);
let nextId = rows.reduce((m, r) => Math.max(m, r.id), 0);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      detail?: unknown;
      url?: unknown;
      appVersion?: unknown;
    } | null;
    const detail = typeof body?.detail === "string" ? body.detail.slice(0, 1000) : "";
    if (!detail) {
      return NextResponse.json({ ok: false, error: "detail kosong" }, { status: 400 });
    }
    const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
    const appVersion =
      typeof body?.appVersion === "string" ? body.appVersion.slice(0, 20) : ua.includes("AGSIAndroidApp") ? "native" : "web";
    const row: ErrorRow = {
      id: ++nextId,
      ts: new Date().toISOString(),
      app_version: appVersion,
      ua,
      detail,
    };
    rows.push(row);
    while (rows.length > MAX_ROWS) rows.shift();
    return NextResponse.json({ ok: true, id: row.id });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (key !== DIAG_KEY) {
    return NextResponse.json({ ok: false, error: "kunci salah" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, rows: [...rows].reverse() });
}
