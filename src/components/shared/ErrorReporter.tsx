"use client";

import { useEffect } from "react";

/**
 * PELAPOR ERROR OTOMATIS (v1.3.18) — pasang sekali di AppShell: menangkap
 * error tak tertangkap (window.onerror + unhandledrejection) dan POST ke
 * /api/client-error supaya pemilik tidak perlu menyalin pesan error manual.
 * Throttle: maks 5 laporan per sesi, identik berurutan tidak diulang.
 */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    let lastDetail = "";
    const report = (detail: string) => {
      if (sent >= 5 || detail === lastDetail) return;
      sent += 1;
      lastDetail = detail;
      try {
        void fetch("/api/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ detail, url: location.href }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        /* pelapor tidak boleh pernah melempar */
      }
    };

    const onError = (e: ErrorEvent) => {
      report(`Uncaught ${e.message} @ ${e.filename}:${e.lineno}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
      report(`Unhandled rejection: ${reason}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
