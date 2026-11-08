"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  Send,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ChickenBadge } from "@/components/logo/ChickenLogo";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import {
  isStaffSender,
  type AppUser,
  type ChatMessageInfo,
  type ChatThreadInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type ChatSheetProps = {
  open: boolean;
  onClose: () => void;
  user: AppUser;
  /** Bila diisi (admin): langsung buka utas pelanggan ini, bukan daftar utas —
      dipakai tombol 💬 di kartu pesanan halaman admin. */
  targetUserId?: string | null;
};

/** Pertanyaan cepat saat chat masih kosong (khusus pelanggan) */
const QUICK_QUESTIONS = [
  "Jam buka sampai jam berapa?",
  "Bisa pesan antar (delivery)?",
  "Menu paling pedas apa ya?",
];

/** Waktu singkat untuk gelembung pesan: cth "14.05" */
function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

/** Waktu relatif untuk daftar utas: "baru saja" / "5 mnt lalu" / "2 jam lalu" */
function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

/**
 * Sheet "Chat CS" — percakapan pelanggan ↔ admin.
 *   - Pelanggan/kasir: langsung masuk utas chat sendiri dengan tim CS.
 *   - Admin/owner: daftar utas pelanggan → pilih satu → baca & balas.
 * Pesan diperbarui otomatis lewat polling ringan tiap 4 detik selama sheet terbuka.
 */
export function ChatSheet({ open, onClose, user, targetUserId = null }: ChatSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const isAdmin = user.role === "ADMIN" || user.role === "OWNER";

  const [threads, setThreads] = useState<ChatThreadInfo[]>([]);
  /** Utas pelanggan yang sedang dibuka admin (null = tampilan daftar) */
  const [openThread, setOpenThread] = useState<ChatThreadInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessageInfo[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const openThreadId = openThread?.id ?? null;

  const fetchMessages = useCallback(async (threadId?: string) => {
    try {
      const res = await apiFetch(
        threadId ? `/api/chat?threadId=${encodeURIComponent(threadId)}` : "/api/chat",
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      setMessages((data.messages ?? []) as ChatMessageInfo[]);
    } catch {
      // diam — coba lagi di polling berikutnya
    }
  }, []);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await apiFetch("/api/chat", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setThreads((data.threads ?? []) as ChatThreadInfo[]);
    } catch {
      // diam
    }
  }, []);

  /** Admin membuka langsung utas satu pelanggan (dari kartu pesanan) —
      utas otomatis dibuat bila pelanggan belum pernah chat. */
  const openThreadByUserId = useCallback(
    async (userId: string) => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/chat?threadUserId=${encodeURIComponent(userId)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (res.ok && data.thread) {
          const t = data.thread as ChatThreadInfo;
          setThreads((cur) => [t, ...cur.filter((x) => x.userId !== userId)]);
          setOpenThread(t);
          await fetchMessages(t.id);
        } else {
          await fetchThreads();
        }
      } catch {
        await fetchThreads();
      } finally {
        setLoading(false);
      }
    },
    [fetchMessages, fetchThreads]
  );

  /** Muat data awal setiap kali sheet dibuka */
  useEffect(() => {
    if (!open) return;
    setOpenThread(null);
    setMessages([]);
    setDraft("");
    // Dari kartu pesanan admin: langsung masuk percakapan pelanggan itu
    if (isAdmin && targetUserId) {
      void openThreadByUserId(targetUserId);
      return;
    }
    setLoading(true);
    const p = isAdmin ? fetchThreads() : fetchMessages();
    void p.finally(() => setLoading(false));
  }, [open, isAdmin, targetUserId, fetchThreads, fetchMessages, openThreadByUserId]);

  /** Polling ringan selama sheet terbuka (daftar / utas aktif) */
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => {
      if (isAdmin) {
        if (openThreadId) void fetchMessages(openThreadId);
        else void fetchThreads();
      } else {
        void fetchMessages();
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [open, isAdmin, openThreadId, fetchMessages, fetchThreads]);

  /** Tutup dengan Escape */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** Gulir otomatis ke pesan terbaru */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const openChatThread = (t: ChatThreadInfo) => {
    setOpenThread(t);
    setMessages([]);
    setLoading(true);
    void fetchMessages(t.id).finally(() => setLoading(false));
    // tandai sudah dibaca secara lokal (server juga mereset unreadAdmin)
    setThreads((cur) => cur.map((x) => (x.id === t.id ? { ...x, unreadAdmin: 0 } : x)));
  };

  const backToList = () => {
    setOpenThread(null);
    setMessages([]);
    setDraft("");
    void fetchThreads();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (isAdmin && !openThread) return;
    setSending(true);
    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isAdmin ? { body: text, userId: openThread!.userId } : { body: text }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Mengirim", message: data.error ?? "Coba lagi sebentar ya." });
        return;
      }
      setMessages((cur) => [...cur, data.message as ChatMessageInfo]);
      setDraft("");
      if (isAdmin && openThread) {
        setThreads((cur) =>
          cur.map((t) =>
            t.id === openThread.id
              ? { ...t, lastMessageBody: text, lastSenderRole: user.role, unreadAdmin: 0 }
              : t
          )
        );
      }
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Periksa jaringan lalu ulangi." });
    } finally {
      setSending(false);
    }
  };

  /** true bila pesan muncul di kanan (dikirim oleh "aku": pelanggan itu sendiri / petugas CS) */
  const mine = (m: ChatMessageInfo) => (isAdmin ? isStaffSender(m.senderRole) : !isStaffSender(m.senderRole));

  const unreadTotal = threads.reduce((s, t) => s + t.unreadAdmin, 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="chat-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Chat CS"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex h-[94dvh] max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[min(760px,92dvh)] sm:rounded-3xl"
          >
            {/* ===== KEPALA ===== */}
            <header className="relative shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                {isAdmin && openThread ? (
                  <button
                    onClick={backToList}
                    aria-label="Kembali ke daftar chat"
                    className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                  >
                    <ArrowLeft className="h-4.5 w-4.5" />
                  </button>
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                    <MessageCircle className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black tracking-wide">
                    {isAdmin
                      ? openThread
                        ? openThread.name
                        : "Chat Pelanggan (CS)"
                      : "Chat CS AGSI"}
                  </p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    {isAdmin
                      ? openThread
                        ? openThread.phone || openThread.email
                        : `${threads.length} percakapan${unreadTotal > 0 ? ` • ${unreadTotal} belum dibaca` : ""}`
                      : "Tim AGSI membalas di jam operasional 10.00–22.00"}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Tutup"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </header>

            {isAdmin && !openThread ? (
              /* ============ ADMIN: DAFTAR UTAS PELANGGAN ============ */
              <div className="scrollbar-slim flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                {loading && threads.length === 0 ? (
                  <div className="flex min-h-[200px] items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-orange-400" />
                  </div>
                ) : threads.length === 0 ? (
                  <div className="mt-6 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-6 text-center">
                    <ChickenBadge size={56} className="mx-auto" />
                    <p className="mt-2 text-xs font-semibold text-neutral-400">
                      Belum ada chat dari pelanggan. Pesan pertama dari pelanggan
                      akan muncul di sini.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {threads.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => openChatThread(t)}
                        className="press-effect flex w-full items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50/40 px-3.5 py-3 text-left transition hover:bg-orange-50"
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-sm font-black text-white">
                          {t.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-black text-neutral-800">{t.name}</span>
                            <span className="shrink-0 text-[10px] font-semibold text-neutral-400">
                              {timeAgo(t.lastMessageAt)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
                            {isStaffSender(t.lastSenderRole) ? "Kamu: " : ""}
                            {t.lastMessageBody ?? "Mulai percakapan"}
                          </span>
                        </span>
                        {t.unreadAdmin > 0 ? (
                          <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 px-1.5 text-[11px] font-black text-white shadow-md">
                            {t.unreadAdmin > 99 ? "99+" : t.unreadAdmin}
                          </span>
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-orange-300" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* ============ PERCAKAPAN (ADMIN & PELANGGAN) ============ */
              <>
                <div
                  ref={listRef}
                  className="scrollbar-slim flex-1 space-y-2.5 overflow-y-auto bg-orange-50/40 px-4 py-4"
                >
                  {loading && messages.length === 0 ? (
                    <div className="flex min-h-[200px] items-center justify-center">
                      <Loader2 className="h-7 w-7 animate-spin text-orange-400" />
                    </div>
                  ) : messages.length === 0 && !isAdmin ? (
                    /* Pelanggan belum pernah chat: sapaan + pertanyaan cepat */
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                      <ChickenBadge size={72} />
                      <div>
                        <p className="text-sm font-black text-neutral-800">Halo, {user.name.split(" ")[0]}! 👋</p>
                        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                          Ada yang bisa dibantu? Tanya stok menu, jam buka, pesanan,
                          atau poin member — tim CS siap membantu.
                        </p>
                      </div>
                      <div className="mt-1 flex w-full max-w-xs flex-col gap-2">
                        {QUICK_QUESTIONS.map((q) => (
                          <button
                            key={q}
                            onClick={() => setDraft(q)}
                            className="press-effect w-full rounded-full border border-orange-200 bg-white px-4 py-2.5 text-[11px] font-bold text-orange-700 shadow-sm transition hover:bg-orange-50"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                      <p className="text-3xl">💬</p>
                      <p className="text-xs font-semibold text-neutral-400">
                        Belum ada pesan di percakapan ini.
                      </p>
                    </div>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={cn("flex w-full", mine(m) ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[80%] rounded-2xl px-3.5 py-2.5 shadow-sm",
                            mine(m)
                              ? "rounded-br-md bg-orange-600 text-white"
                              : "rounded-bl-md border border-orange-100 bg-white text-neutral-800"
                          )}
                        >
                          {!mine(m) && (
                            <p className="mb-0.5 text-[10px] font-black uppercase tracking-wide text-orange-600">
                              {isStaffSender(m.senderRole) ? "CS AGSI" : m.senderName}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                            {m.body}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-right text-[9px] font-semibold",
                              mine(m) ? "text-orange-100/80" : "text-neutral-400"
                            )}
                          >
                            {clockTime(m.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* ===== KOMPOSER ===== */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                  className="flex shrink-0 items-center gap-2 border-t border-orange-100 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]
                    "
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={500}
                    placeholder={isAdmin ? "Balas pelanggan…" : "Tulis pesanmu…"}
                    className="border-orange-200 focus-visible:ring-orange-400"
                    aria-label="Tulis pesan"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || sending}
                    aria-label="Kirim pesan"
                    className="press-effect flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white shadow-lg shadow-orange-500/30 transition hover:bg-orange-700 disabled:opacity-50"
                  >
                    {sending ? (
                      <Loader2 className="h-4.5 w-4.5 animate-spin" />
                    ) : (
                      <Send className="h-4.5 w-4.5" />
                    )}
                  </button>
                </form>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
