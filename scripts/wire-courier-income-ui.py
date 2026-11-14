#!/usr/bin/env python3
"""
Beranda kurir: kartu PENDAPATAN HARI INI & KEMARIN (ongkir pesanan
selesai, batas hari WIB) + tombol & sheet RIWAYAT PENGANTARAN.
Sumber data: GET /api/courier/income (baru).
Exact-match, idempoten. Jalankan dari root: python3 scripts/wire-courier-income-ui.py
"""
import os, sys

ROOT = "/home/z/my-project"
F = "src/components/courier/CourierHomeView.tsx"
full = os.path.join(ROOT, F)
s = open(full).read()

if "/api/courier/income" in s:
    print("SKIP: sudah dipasang")
    sys.exit(0)

EDITS = [
    # A. lucide icons baru
    ('  Bike,\n  CheckCheck,\n',
     '  Banknote,\n  Bike,\n  CheckCheck,\n'),
    ('  HandCoins,\n  Loader2,\n',
     '  HandCoins,\n  History,\n  Loader2,\n'),
    ('  Wallet,\n} from "lucide-react";',
     '  Wallet,\n  X,\n} from "lucide-react";'),
    # B. createPortal
    ('import { useCallback, useEffect, useState } from "react";\n',
     'import { useCallback, useEffect, useState } from "react";\nimport { createPortal } from "react-dom";\n'),
    # C. tipe IncomeData
    ('type Tab = "antaran" | "selesai";',
     '/** Pendapatan kurir (ongkir) + riwayat pengantaran — GET /api/courier/income */\n'
     'type IncomeData = {\n'
     '  today: { amount: number; count: number };\n'
     '  yesterday: { amount: number; count: number };\n'
     '  history: Array<{\n'
     '    id: string;\n'
     '    code: string;\n'
     '    customerName: string;\n'
     '    deliveryArea: string | null;\n'
     '    address: string | null;\n'
     '    deliveryFee: number;\n'
     '    paymentMethod: string;\n'
     '    updatedAt: string;\n'
     '  }>;\n'
     '};\n\n'
     'type Tab = "antaran" | "selesai";'),
    # D. state baru
    ('  const [setoran, setSetoran] = useState<SetoranData | null>(null);\n',
     '  const [setoran, setSetoran] = useState<SetoranData | null>(null);\n'
     '  const [income, setIncome] = useState<IncomeData | null>(null);\n'
     '  const [historyOpen, setHistoryOpen] = useState(false);\n'),
    # E1. fetch endpoint ketiga
    ('      const [dRes, sRes] = await Promise.all([\n'
     '        apiFetch("/api/courier/deliveries", { cache: "no-store" }),\n'
     '        apiFetch("/api/courier/setoran", { cache: "no-store" }),\n'
     '      ]);\n',
     '      const [dRes, sRes, iRes] = await Promise.all([\n'
     '        apiFetch("/api/courier/deliveries", { cache: "no-store" }),\n'
     '        apiFetch("/api/courier/setoran", { cache: "no-store" }),\n'
     '        apiFetch("/api/courier/income", { cache: "no-store" }),\n'
     '      ]);\n'),
    # E2. simpan hasil
    ('      if (sRes.ok) setSetoran((await sRes.json()) as SetoranData);\n',
     '      if (sRes.ok) setSetoran((await sRes.json()) as SetoranData);\n'
     '      if (iRes.ok) setIncome((await iRes.json()) as IncomeData);\n'),
    # F. derived riwayat antaran
    ('  const riwayat = (setoran?.riwayat ?? []).slice(0, 3);\n',
     '  const riwayat = (setoran?.riwayat ?? []).slice(0, 3);\n'
     '  const riwayatAntaran = income?.history ?? [];\n'),
    # G. kartu pendapatan setelah header
    ('      </header>\n',
     '      </header>\n\n'
     '      {/* ===== PENDAPATAN KURIR (ongkir pesanan selesai, WIB) ===== */}\n'
     '      <motion.section\n'
     '        initial={prefersReduced ? false : { opacity: 0, y: 12 }}\n'
     '        animate={{ opacity: 1, y: 0 }}\n'
     '        transition={{ duration: 0.3 }}\n'
     '        className="mb-4"\n'
     '      >\n'
     '        <div className="grid grid-cols-2 gap-2.5">\n'
     '          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-600 to-emerald-500 p-3.5 text-white shadow-md shadow-emerald-500/25">\n'
     '            <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-emerald-100">\n'
     '              <Banknote className="h-3.5 w-3.5" /> Pendapatan Hari Ini\n'
     '            </p>\n'
     '            <p className="mt-1 text-xl font-black leading-tight">\n'
     '              {formatIDR(income?.today.amount ?? 0)}\n'
     '            </p>\n'
     '            <p className="text-[10px] font-semibold text-emerald-100">\n'
     '              {income?.today.count ?? 0} pengantaran selesai\n'
     '            </p>\n'
     '          </div>\n'
     '          <div className="rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-sm">\n'
     '            <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-neutral-400">\n'
     '              <Banknote className="h-3.5 w-3.5" /> Kemarin\n'
     '            </p>\n'
     '            <p className="mt-1 text-xl font-black leading-tight text-neutral-800">\n'
     '              {formatIDR(income?.yesterday.amount ?? 0)}\n'
     '            </p>\n'
     '            <p className="text-[10px] font-semibold text-neutral-400">\n'
     '              {income?.yesterday.count ?? 0} pengantaran\n'
     '            </p>\n'
     '          </div>\n'
     '        </div>\n'
     '        <button\n'
     '          onClick={() => setHistoryOpen(true)}\n'
     '          className="press-effect mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white py-2.5 text-[12px] font-black text-emerald-700 shadow-sm hover:bg-emerald-50"\n'
     '        >\n'
     '          <History className="h-4 w-4" /> Riwayat Pengantaran\n'
     '          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">\n'
     '            {riwayatAntaran.length}\n'
     '          </span>\n'
     '        </button>\n'
     '      </motion.section>\n'),
    # H. sheet riwayat sebelum penutup komponen
    ('          <RefreshCw className="h-3.5 w-3.5" /> {error} — Ketuk untuk coba lagi\n'
     '        </button>\n'
     '      )}\n'
     '    </div>\n'
     '  );\n'
     '}',
     '          <RefreshCw className="h-3.5 w-3.5" /> {error} — Ketuk untuk coba lagi\n'
     '        </button>\n'
     '      )}\n\n'
     '      {/* ===== SHEET RIWAYAT PENGANTARAN ===== */}\n'
     '      {createPortal(\n'
     '        <AnimatePresence>\n'
     '          {historyOpen && (\n'
     '            <motion.div\n'
     '              key="riwayat-overlay"\n'
     '              initial={prefersReduced ? false : { opacity: 0 }}\n'
     '              animate={{ opacity: 1 }}\n'
     '              exit={prefersReduced ? undefined : { opacity: 0 }}\n'
     '              className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"\n'
     '              role="dialog"\n'
     '              aria-modal="true"\n'
     '              aria-label="Riwayat Pengantaran"\n'
     '              onClick={(e) => {\n'
     '                if (e.target === e.currentTarget) setHistoryOpen(false);\n'
     '              }}\n'
     '            >\n'
     '              <motion.div\n'
     '                initial={prefersReduced ? false : { y: 48, scale: 0.97 }}\n'
     '                animate={{ y: 0, scale: 1 }}\n'
     '                exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}\n'
     '                transition={{ type: "spring", damping: 28, stiffness: 320 }}\n'
     '                className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"\n'
     '              >\n'
     '                <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3.5">\n'
     '                  <div className="min-w-0">\n'
     '                    <h2 className="text-sm font-black text-neutral-900">Riwayat Pengantaran 🛵</h2>\n'
     '                    <p className="text-[10px] text-neutral-400">\n'
     '                      30 pengantaran terakhir — ongkir = pendapatanmu (tidak ikut disetor)\n'
     '                    </p>\n'
     '                  </div>\n'
     '                  <button\n'
     '                    onClick={() => setHistoryOpen(false)}\n'
     '                    aria-label="Tutup riwayat"\n'
     '                    className="press-effect flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 hover:bg-neutral-200"\n'
     '                  >\n'
     '                    <X className="h-4 w-4" />\n'
     '                  </button>\n'
     '                </div>\n'
     '                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">\n'
     '                  {riwayatAntaran.length === 0 ? (\n'
     '                    <div className="flex flex-col items-center gap-2 py-10 text-center">\n'
     '                      <History className="h-9 w-9 text-emerald-200" />\n'
     '                      <p className="text-[13px] font-black text-neutral-500">Belum ada pengantaran selesai</p>\n'
     '                      <p className="max-w-[260px] text-[11px] leading-relaxed text-neutral-400">\n'
     '                        Setiap pesanan yang kamu tandai "Sampai Tujuan" tercatat di sini beserta ongkirnya.\n'
     '                      </p>\n'
     '                    </div>\n'
     '                  ) : (\n'
     '                    <ul className="space-y-2">\n'
     '                      {riwayatAntaran.map((h) => (\n'
     '                        <li\n'
     '                          key={h.id}\n'
     '                          className="flex items-center gap-3 rounded-xl border border-neutral-100 bg-white px-3 py-2.5 shadow-sm"\n'
     '                        >\n'
     '                          <div className="min-w-0 flex-1">\n'
     '                            <p className="truncate text-[12px] font-black text-neutral-800">\n'
     '                              {h.code} • {h.customerName}\n'
     '                            </p>\n'
     '                            <p className="truncate text-[10px] text-neutral-400">\n'
     '                              {formatDateTime(h.updatedAt)}\n'
     '                              {h.deliveryArea ? ` • ${h.deliveryArea}` : ""}\n'
     '                            </p>\n'
     '                          </div>\n'
     '                          <div className="shrink-0 text-right">\n'
     '                            <p className="text-[13px] font-black text-emerald-600">\n'
     '                              +{formatIDR(h.deliveryFee)}\n'
     '                            </p>\n'
     '                            <p className="text-[9px] font-bold uppercase text-neutral-400">\n'
     '                              {h.paymentMethod === "CASH" ? "COD" : "Digital"}\n'
     '                            </p>\n'
     '                          </div>\n'
     '                        </li>\n'
     '                      ))}\n'
     '                    </ul>\n'
     '                  )}\n'
     '                </div>\n'
     '              </motion.div>\n'
     '            </motion.div>\n'
     '          )}\n'
     '        </AnimatePresence>,\n'
     '        document.body\n'
     '      )}\n'
     '    </div>\n'
     '  );\n'
     '}'),
]

for i, (old, new) in enumerate(EDITS):
    if old not in s:
        print(f"GAGAL cocok edit #{i}: {old[:60]!r}")
        sys.exit(1)
    s = s.replace(old, new, 1)

open(full, "w").write(s)
print("OK: CourierHomeView.tsx dipasang")
